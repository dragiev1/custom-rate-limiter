import rateLimit from '../../src/rate-limit'
import { describe, expect, it, jest } from "@jest/globals"
import { createServer } from './create-server'
import { agent as request } from 'supertest'
import { ClientRateLimitInfo, Options, RateLimitInfo, Store } from '../../src/types'
import { setDraft6Headers, setDraft7Headers, setDraft8Headers, setLegacyHeaders, setRetryAfterHeader } from '../../src/headers'
import { Response } from 'express'
import { parseRateLimit } from 'ratelimit-header-parser'

describe('headers test', () => {
    it('should send the correct `x-ratelimit-limit`, `x-ratelimit-remaining`, `x-ratelimit-reset` headers', async () => {
        const app = createServer(rateLimit({
            windowMs: 60 * 1000,
            limit: 5,
            legacyHeaders: true,
        }))

        const expectedResetTimestamp = Math.ceil((Date.now() + 60 * 1000) / 1000)

        const response = await request(app)
            .get('/')
            .expect('x-ratelimit-limit', '5')
            .expect('x-ratelimit-remaining', '4')
            .expect(200, 'Hello!')
        
        const actualResetTimestamp = Number(response.get('x-ratelimit-reset'))
        expect(actualResetTimestamp).toBeGreaterThanOrEqual(
            expectedResetTimestamp - 1,
        )
        expect(actualResetTimestamp).toBeLessThanOrEqual(expectedResetTimestamp + 1)
    })

    it('should send correct `ratelimit-*` headers for standard headers draft 6', async () => {
        const app = createServer(rateLimit({
            limit: 5,
            windowMs: 60 * 1000,
            standardHeaders: true,
        }))

        await request(app)
            .get('/')
            .expect('ratelimit-policy', '5;w=60')
            .expect('ratelimit-remaining', '4')
            .expect('ratelimit-limit', '5')
            .expect('ratelimit-reset', '60')
            .expect(200, 'Hello!')
    })

    it('should send policy and combined rate-limit headers for the standard draft-7', async () => {
        const app = createServer(rateLimit({
            limit: 5,
            windowMs: 60 * 1000,
            standardHeaders: 'draft-7',
        }))

        await request(app)
            .get('/')
            .expect('ratelimit-policy', '5;w=60')
            .expect('ratelimit', 'limit=5, remaining=4, reset=60')
            .expect(200, 'Hello!')
    })

    it('should send proper headers for the standard draft-8', async () => {
        const app = createServer(rateLimit({
            limit: 5,
            windowMs: 3 * 60 * 1000,  // 3min
            standardHeaders: 'draft-8',
            keyGen: (_req, _res) => 'foo',
        }))

        const policy = `"5-in-3min"; q=5; w=180; pk=MmMyNmI0NmI2OGZm`
		const limit = '"5-in-3min"; r=4; t=180'

        await request(app)
            .get('/')
            .expect('ratelimit', limit)
            .expect('ratelimit-policy', policy)
            .expect(200, 'Hello!')
    })

    it('should handle multiple headers for the standard draft-8', async () => {
        const options: Partial<Options> = {
            standardHeaders: 'draft-8',
            keyGen: (_req, _res) => 'foo',
            validate: false
        }
        
        const app = createServer([
            rateLimit({...options, limit: 6, windowMs: 2 * 60 * 60 * 1000}),
            rateLimit({...options, limit: 4, windowMs: 60 * 1000}),
            rateLimit({...options, limit: 2, windowMs: 24 * 60 * 60 * 1000}),
        ])

        const limits = [
            `"6-in-2hrs"; r=5; t=7200`,
            `"4-in-1min"; r=3; t=60`,
            `"2-in-1days"; r=1; t=86400`,
        ]
        const policies = [
            `"6-in-2hrs"; q=6; w=7200; pk=MmMyNmI0NmI2OGZm`,
            `"4-in-1min"; q=4; w=60; pk=MmMyNmI0NmI2OGZm`,
            `"2-in-1days"; q=2; w=86400; pk=MmMyNmI0NmI2OGZm`
        ]

        await request(app).get('/')
            .expect(200, 'Hello!')
            .expect('ratelimit', limits.join(', '))
            .expect('ratelimit-policy', policies.join(', '))
    })

    it('should override the quota name if specified for the standard draft-8', async () => {
        const app = createServer(rateLimit({
            limit: 5,
            windowMs: 60 * 1000,
            identifier: 'yellow',
            standardHeaders: 'draft-8',
            keyGen: (_res, _req) => 'foo',
        }))

        await request(app).get('/')
            .expect(200, 'Hello!')
            .expect('ratelimit', '"yellow"; r=4; t=60')
            .expect('ratelimit-policy', '"yellow"; q=5; w=60; pk=MmMyNmI0NmI2OGZm')
    })

    it('should return `retry-after` header once IP has reached the max', async () => {
        const app = createServer(rateLimit({
            limit: 2,
            windowMs: 60 * 1000,
        }))

        await request(app).get('/').expect(200, "Hello!")
        await request(app).get('/').expect(200, "Hello!")
            
        await request(app).get('/').expect(429).expect('retry-after', '60')
    })

    it('should not set the `retry-after` header if all headers have been disabled', async () => {
        const app = createServer(rateLimit({
            limit: 1,
            windowMs: 60 * 1000,
            legacyHeaders: false,
            standardHeaders: false,
        }))

        await request(app).get('/').expect(200, "Hello!")
        const response = await request(app).get('/').expect(429)
        expect(response.get('retry-after')).toBeUndefined()
    })

    it('should not try to set headers if request.headersSent is true', () => {
        const response: Response = {
            headersSent: true,
            setHeader: jest.fn(),
        } as any
        const info: RateLimitInfo = {
            limit: 5,
            hits: 1,
            remaining: 4,
            resetTime: new Date(),
            key: 'foo',
        }
        const windowMs = 60 * 1000
        const name = 'test-quota'
        const key = 'foo'

        setLegacyHeaders(response, info)
        setDraft6Headers(response, info, windowMs)
        setDraft7Headers(response, info, windowMs)
        setDraft8Headers(response, info, windowMs, key, name)
        setRetryAfterHeader(response, info, windowMs)
        
        expect(response.setHeader).not.toHaveBeenCalled()
    })

    it('should not send headers for an incorrect draft number', async () => {
        const app = createServer(rateLimit({
            limit: 4,
            windowMs: 2 * 60 * 60 * 1000,
            standardHeaders: 'invalid-draft-version',
            validate: { headersDraftVersion: false },
        }))

        const response = await request(app).get('/').expect(200, 'Hello!')
        expect(response.get('ratelimit')).toBeUndefined()
        expect(response.get('ratelimit-policy')).toBeUndefined()
    })

    describe('store support that does not provide `resetTime`',  () => {
        class MockStore implements Store {
            hits: Map<string, number> = new Map()
            
            async get(key: string): Promise<ClientRateLimitInfo> {
                return {
                    totalHits: this.hits.get(key) ?? 0,
                    resetTime: undefined,
                }
            }

            async increment(key: string): Promise<ClientRateLimitInfo> {
                const count = (this.hits.get(key) ?? 0) + 1
                this.hits.set(key, count)
                return { totalHits: count, resetTime: undefined }
            }

            async decrement(_key: string): Promise<void> {}
            async resetKey(_key: string): Promise<void> {}
        }

        it('should set the `retry-after` header to the value of `windowMs` in seconds instead', async () => {
            const app = createServer(rateLimit({
                limit: 1,
                windowMs: 60 * 1000,
                store: new MockStore(),
                legacyHeaders: true,
                standardHeaders: true,
            }))

            await request(app).get('/').expect(200)
            await request(app).get('/').expect(429).expect('retry-after', '60')
        })
    })

    describe('ratelimit-header-parset compatibility', () => {
        it('should emit legacy headers that ratelimit-header-parset can read', async () => {
            const app = createServer(rateLimit({
                limit: 1,
                windowMs: 60 * 1000,
                legacyHeaders: true,
                standardHeaders: false,
            }))

            const response = await request(app).get('/').expect(200)
            const rateLimitDetails = parseRateLimit(response as any)

            expect(rateLimitDetails).toMatchObject({
                used: 1,
                remaining: 0,
                limit: 1,
                reset: expect.any(Date)
            })
        })

        it('should emit standard draft-6 headers that ratelimit-header-parset can read', async () => {
            const app = createServer(rateLimit({
                windowMs: 60 * 1000,
                limit: 5,
                legacyHeaders: false,
                standardHeaders: 'draft-6',
            }))

            const response = await request(app).get('/').expect(200, 'Hello!')
            const rateLimitInfo = parseRateLimit(response as any)

            expect(rateLimitInfo).toMatchObject({
                used: 1,
                remaining: 4,
                limit: 5,
                reset: expect.any(Date)
            })
        })

        it('should emit a standard draft-7 combined header that ratelimit-header-parser can read', async () => {
            const app = createServer(rateLimit({
                windowMs: 60 * 1000,
                limit: 5,
                legacyHeaders: false,
                standardHeaders: 'draft-7'
            }))

            const response = await request(app).get('/').expect(200, 'Hello!')
            const rateLimitInfo = parseRateLimit(response as any)

            expect(rateLimitInfo).toMatchObject({
                used: 1,
                remaining: 4,
                limit: 5,
                reset: expect.any(Date)
            })
        })

        it('should send RateLimit-Reset header with a value of 0 when window has just expired for draft-6', async () => {
            class MockStore implements Store {
                hits: Map<string, number> = new Map()

                async get(key: string): Promise<ClientRateLimitInfo> {
                    return {
                        totalHits: this.hits.get(key) ?? 0,
                        resetTime: new Date(Date.now())
                    }
                }

                async increment(key: string): Promise<ClientRateLimitInfo> {
                    const count = (this.hits.get(key) ?? 0) + 1
                    this.hits.set(key, count)
                    return {
                        totalHits: count,
                        resetTime: new Date(Date.now())
                    }
                }

                async decrement(_key: string): Promise<void> {}
                async resetKey(_key: string): Promise<void> {}
            }
            
            const app = createServer(rateLimit({
                windowMs: 60 * 1000,
                limit: 5,
                store: new MockStore(),
                legacyHeaders: false,
                standardHeaders: 'draft-6'
            }))

            await request(app)
                .get('/')
                .expect(200, 'Hello!')
                .expect('ratelimit-policy', '5;w=60')
                .expect('ratelimit-limit', '5')
                .expect('ratelimit-remaining', '4')
                .expect('ratelimit-reset', '0')
        })
    })
})