// Tests built in memory store
import { describe, beforeEach, afterEach, jest, it, expect } from '@jest/globals'
import { MemoryStore } from '../../src/memory-store'
import { Options } from '../../src/types'

const min = 60 * 1000

// Start of the memory store test
describe('memory store test', () => {
    beforeEach(() => {
        jest.useFakeTimers()
        jest.spyOn(globalThis, 'clearInterval')  // Test the cleanup process of the memory store when periodically sweeping server's RAM and delete old rate-limit records 
    })
    afterEach(() => {
        jest.useRealTimers()
        jest.restoreAllMocks()
    })


    it('returns the current hit count and reset time for a key', async () => {
        const store = new MemoryStore()
        store.init({ windowMs: min } as Options)
        const key = 'test-score'

        await store.inc(key)

        const response = await store.get(key)
        expect(response).toMatchObject({
            totalHits: 1,
            resetTime: expect.any(Date)
        })
    })

    it('sets the value to 1 on first call to `inc`', async () => {
        const store = new MemoryStore()
        store.init({ windowMs: min } as Options)
        const key = 'testing-inc'

        const { totalHits } = await store.inc(key)
        expect(totalHits).toEqual(1)
    })


    it('decrements key for the store when `dec` is called', async () => {
        const store = new MemoryStore()
        store.init({ windowMs: min } as Options) 
        const key = 'testing-dec'

        await store.inc(key)
        await store.dec(key)
        const response = await store.get(key)
        expect(response?.totalHits).toEqual(0)
    })

    it('does not decrement when the key is below 0 and `dec` is called', async () => {
        const store = new MemoryStore()
        store.init({ windowMs: min } as Options)
        const key = 'test-dec'

        await store.inc(key)  // totalHits = 1
        await store.dec(key)  // totalHits = 0
        await store.dec(key)  // totalHits = 0 (no change/not negative)

        const response = await store.get(key)
        expect(response).toBeDefined()
        expect(response?.totalHits).toEqual(0)
    })

    it('resetKey should remove the key from storage', async () => {
        const store = new MemoryStore()
        const key = 'test-key'

        await store.inc(key)
        let response = await store.get(key)
        expect(response).toBeDefined()

        await store.resetKey(key)
        response = await store.get(key)
        expect(response).toBeUndefined()
    })

    it('resets the count for a key in the store when `resetKey` is called', async () => {
        const store = new MemoryStore()
        const key = 'test-key'
        store.init({ windowMs: min } as Options)

        await store.inc(key)
        await store.resetKey(key)

        const totalHits = (await store.inc(key)).totalHits
        expect(totalHits).toEqual(1)
    })
})