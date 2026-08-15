// Tests built in memory store
import { describe, beforeEach, afterEach, jest, it, expect } from '@jest/globals'
import { MemoryStore } from '../../src/memory-store'
import { Options } from '../../src/types'
import { clearInterval } from 'node:timers'

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
        const key = 'test-resetKey'

        await store.inc(key)
        let response = await store.get(key)
        expect(response).toBeDefined()

        await store.resetKey(key)
        response = await store.get(key)
        expect(response).toBeUndefined()
    })

    it('resets the count for a key in the store when `resetKey` is called', async () => {
        const store = new MemoryStore()
        const key = 'test-resetKey'
        store.init({ windowMs: min } as Options)

        await store.inc(key)
        await store.resetKey(key)

        const totalHits = (await store.inc(key)).totalHits
        expect(totalHits).toEqual(1)
    })

    it('resets the count for all keys inside store when `resetAll` is used', async () => {
        const store = new MemoryStore()
        const key1 = 'test-resetAll'
        const key2 = 'test-resetAll2'
        store.init({ windowMs: min } as Options)

        await store.inc(key1)
        await store.inc(key2)
        // Check if client rate limit info exists first for both keys 
        let response1 = await store.get(key1)
        let response2 = await store.get(key2)
        expect(response1).toBeDefined()
        expect(response2).toBeDefined()

        // Reset all and check if they are properly undefined
        await store.resetAll()
        response1 = await store.get(key1)
        response2 = await store.get(key2)
        expect(response1).toBeUndefined()
        expect(response2).toBeUndefined()
    })

    it('clears the timer when `shutdown` is called', async () => {
        const store = new MemoryStore()
        store.init({ windowMs: min } as Options)
        expect(store.interval).toBeDefined()

        store.shutdown()
        expect(clearInterval).toHaveBeenCalledWith(store.interval)
    })

    it('resets count for all the keys in the store when the timeout is reached', async () => {
        const store = new MemoryStore()
        store.init({ windowMs: min } as Options)
        const key1 = 'test-resetKey1'
        const key2 = 'test-resetKey2'

        await store.inc(key1)
        await store.inc(key2)
        jest.advanceTimersByTime(min + 1000)  // 61 seconds later
        const { totalHits: totalHits1 } = await store.inc(key1) 
        const { totalHits: totalHits2 } = await store.inc(key2)
        expect(totalHits1).toEqual(1)
        expect(totalHits2).toEqual(1)
    })
    

})