// Testing validation.ts for strict configuration rules
import { it, beforeEach, afterEach, jest, describe, expect } from '@jest/globals'
import { getValidations, Validations } from '../../src/validations'
import { Logger } from '../../src/types'

describe('validation tests', () => {
    let validations: Validations
    let logger: Logger
    
    beforeEach(() => {
        logger = {
            warn: jest.fn(),
            error: jest.fn()
        }

        validations = getValidations(true, logger)
    })
    
    describe('ip', () => {
        it('should allow a valid IPv4', () => {
            validations.ip('1.2.2.1')
            expect(logger.error).not.toHaveBeenCalled()
        })

        it('should log an error for an invalid IP', () => {
            validations.ip('1.2.3')
            expect(logger.error).toHaveBeenCalled()

            validations.ip('grrr')
            expect(logger.error).toHaveBeenCalled()

            validations.ip('1.2.3.4.5')
            expect(logger.error).toHaveBeenCalled()
        })

        it('should allow a valid IPv6', () => {
            validations.ip('1200:0000:AB00:1234:0000:2552:7777:1111')
            expect(logger.error).not.toHaveBeenCalled()
        })

        it('should log an error for an undefined IP', () => {
            validations.ip(undefined)
            expect(logger.error).toHaveBeenCalled()
        })

        it('should log an error for an IPv6 with a port', () => {
            validations.ip('[1200:0000:AB00:1234:0000:2552:7777:1313]:1234')
            expect(logger.error).toHaveBeenCalled()
        })

        it('should log an error for an IPv4 with a port', () => {
            validations.ip('1.2.3.4:1234')
            expect(logger.error).toHaveBeenCalled()
        })
    })

    describe('trustProxy', () => {
        it('should log an error on "trust proxy" set to true', () => {
            validations.trustProxy({app: {get: () => true}} as any)  // Mock object that returns get true function to turn on trustProxy
            expect(logger.error).toHaveBeenCalled()  // Should error because trustProxy is bad, read commments in src/validations.ts for more information
        })

        it.each([
            false,
            '1.2.3.4',
            /1.2.3.4/,
            ['1.2.3.4'],
        ])('should not log an error on "trust proxy" = %s', (val) => {
            validations.trustProxy({ app: {get: () => val }} as any)
            expect(logger.error).not.toHaveBeenCalled()
        })
    })

    describe('xForwardedFor', () => {
        it.each([
            [{'x-forwarded-for': '1.2.3.4'}, true],
            [{}, false],
            [{}, true],
        ])('should log an error with x-forwarded-for header and "trust proxy" is %s', (headers, trustProxy) => {
            validations.xForwardedForHeader({
                app: { get: () => trustProxy},
                headers,
            } as any)
            expect(logger.error).not.toHaveBeenCalled()
        })

        it('should log an error with x-forwarded-for header and "trust proxy" is false', () => {
            validations.xForwardedForHeader({
                app: { get: () => false },
                headers: { 'x-forwarded-for': '1.2.3.4'},
            } as any)
            expect(logger.error).toHaveBeenCalled()
        })
    })

    describe('forwardedHeader', () => {
        // Simulates a normal non proxy direct request; raw client IP
        it('should not log an error when the forwarded header is unset', () => {
            // Passing in a fake request object
            validations.forwardedHeader({
                headers: {},
                ip: '1.2.3.4',
                // Remote address is the IP address of the machine that made the direct TCP connection to the server
                socket: { remoteAddress: '1.2.3.4' },
            } as any)
            expect(logger.error).not.toHaveBeenCalled()
        })

        // Simulates a suspicious proxy directed request; forwarded ip is spoofed and by an untrusted header, thus must be ignored and look at just the `req.ip`
        it('should log an error when the forwarded header is set', () => {
            validations.forwardedHeader({
                headers: { forwarded: '1.1.1.1' },
                ip: '1.2.3.4',
                socket: { remoteAddress: '1.2.3.4' },
            } as any)
            expect(logger.error).toHaveBeenCalledWith(
                expect.objectContaining({ code: 'CRL_ERR_FORWARDED_HEADER' })
            )
        })

        // Heuristic test for when a forwarded header is present, but Express's `req.ip` looks like the raw socket IP
        it('should not log an error when `req.ip` has been set to a non-default value', () => {
            validations.forwardedHeader({
                headers: { forwarded: '1.1.1.1'},
                ip: '1.1.1.100',
                socket: { remoteAddress: '1.1.1.2'}
            } as any)
            expect(logger.error).not.toHaveBeenCalled()
        })
    })

    describe('positiveHits', () => {
        it('should log an error if hits is non-numeric', () => {
            validations.positiveHits(true)
            expect(logger.error).toHaveBeenCalled()
        })

        it('should log an error if hits is <1', () => {
            validations.positiveHits(-1)
            expect(logger.error).toHaveBeenCalled()

            validations.positiveHits(0)
            expect(logger.error).toHaveBeenCalled()
        })

        it('should log an error if hits is not an integer', () => {
            validations.positiveHits('0')
            expect(logger.error).toHaveBeenCalled()
        })

        it('should not log an error if hits is a positive integer', () => {
            validations.positiveHits(1)
            expect(logger.error).not.toHaveBeenCalled()
        })
    })

    
})