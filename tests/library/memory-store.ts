// Tests built in memory store
import {
  describe,
  beforeEach,
  afterEach,
  jest,
  it,
  expect,
} from "@jest/globals"
import { MemoryStore } from "../../src/memory-store"
import { Options } from "../../src/types"
import { clearInterval } from "node:timers"

const min = 60 * 1000

// Start of the memory store test
describe("memory store test", () => {
  beforeEach(() => {
    jest.useFakeTimers()
    jest.spyOn(globalThis, "clearInterval") // Test the cleanup process of the memory store when periodically sweeping server's RAM and delete old rate-limit records
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })

  it("returns the current hit count and reset time for a key", async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min } as Options)
    const key = "test-score"

    await store.increment(key)

    const response = await store.get(key)
    expect(response).toMatchObject({
      totalHits: 1,
      resetTime: expect.any(Date),
    })
  })

  it("sets the value to 1 on first call to `increment`", async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min } as Options)
    const key = "testing-increment"

    const { totalHits } = await store.increment(key)
    expect(totalHits).toEqual(1)
  })

  it("decrements key for the store when `dec` is called", async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min } as Options)
    const key = "testing-dec"

    await store.increment(key)
    await store.decrement(key)
    const response = await store.get(key)
    expect(response?.totalHits).toEqual(0)
  })

  it("does not decrement when the key is below 0 and `dec` is called", async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min } as Options)
    const key = "test-dec"

    await store.increment(key) // totalHits = 1
    await store.decrement(key) // totalHits = 0
    await store.decrement(key) // totalHits = 0 (no change/not negative)

    const response = await store.get(key)
    expect(response).toBeDefined()
    expect(response?.totalHits).toEqual(0)
  })

  it("resetKey should remove the key from storage", async () => {
    const store = new MemoryStore()
    const key = "test-resetKey"

    await store.increment(key)
    let response = await store.get(key)
    expect(response).toBeDefined()

    await store.resetKey(key)
    response = await store.get(key)
    expect(response).toBeUndefined()
  })

  it("resets the count for a key in the store when `resetKey` is called", async () => {
    const store = new MemoryStore()
    const key = "test-resetKey"
    store.init({ windowMs: min } as Options)

    await store.increment(key)
    await store.resetKey(key)

    const totalHits = (await store.increment(key)).totalHits
    expect(totalHits).toEqual(1)
  })

  it("resets the count for all keys inside store when `resetAll` is used", async () => {
    const store = new MemoryStore()
    const key1 = "test-resetAll"
    const key2 = "test-resetAll2"
    store.init({ windowMs: min } as Options)

    await store.increment(key1)
    await store.increment(key2)
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

  it("clears the timer when `shutdown` is called", async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min } as Options)
    expect(store.interval).toBeDefined()

    store.shutdown()
    expect(globalThis.clearInterval).toHaveBeenCalledWith(store.interval)
  })

  it("resets count for all the keys in the store when the timeout is reached", async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min } as Options)
    const key1 = "test-resetKey1"
    const key2 = "test-resetKey2"

    await store.increment(key1)
    await store.increment(key2)
    jest.advanceTimersByTime(min + 1000) // 61 seconds later
    const { totalHits: totalHits1 } = await store.increment(key1)
    const { totalHits: totalHits2 } = await store.increment(key2)
    expect(totalHits1).toEqual(1)
    expect(totalHits2).toEqual(1)
  })

  // Touches on a topic called Environment Compatibility (Isomorphic Code)
  /**
   * Tests whether the code will crash when run in a web-browser-like environment.
   * Node.js vs Browser timers behave differently on where the code is running.
   * Node.js `setInterval()` returns a `Timeout` instance, which has special methods attached to it. (ex: `.unref()`)
   * Web browser `setInterval()` returns a simple Number (integer ID) and Numbers do not have said special methods. (ex: no `.unref()`)
   * Node.js will keep server running forever just to keep the timer alive, So one needs to call `.unref()` to stop them.
   * Browsers combine Chromium + Node.js together and developers sometimes bundle backend libraries to run in environments that mimic browsers.
   * So in all of these environments, `setInterval` returns a Number, not a Node.js object.
   * This tests passes because we use `?.` chaining operator to safely prevent calling `.unref()` on a Number.
   */
  it("can run in electron where setInterval does not return a Timeout object with an unset function", async () => {
    const ogSetInterval = globalThis.setInterval
    let timeoutId = 1
    let realTimeoutId: NodeJS.Timer
    // @ts-expect-error  We want to not return a deprecated Timer instance for testing
    jest.spyOn(globalThis, "setTimeout").mockImplementation((callback, timeout) => {
        realTimeoutId = ogSetInterval(callback, timeout)
        return timeoutId++
      })

    const store = new MemoryStore()
    store.init({ windowMs: -1 } as Options)
    const key = "test-store"

    try {
      const { totalHits } = await store.increment(key)
      expect(totalHits).toEqual(1)
    } finally {
      // @ts-expect-error  `realTimeoutId` is already set in the `spyOn` call
      clearTimeout(realTimeoutId)
    }
  })

  // Checks idempotency and safety of store's `init()` method, so calling it twice does not reset the information or cause hiccups on the server
  it("should automatically clear previously set time intervals", async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min } as Options)
    const previousInterval = store.interval

    store.init({ windowMs: min} as Options)    
    expect(globalThis.clearInterval).toHaveBeenCalledWith(previousInterval)
  })

  it('should move clients from previous to current', async () => {
    const store = new MemoryStore()
    store.init({ windowMs: min} as Options)
    const key = 'test-store'

    await store.increment(key)
    expect(store.current.has(key)).toEqual(true)
    expect(store.previous.has(key)).toEqual(false)

    jest.advanceTimersByTime(min + 1000)  // 61 seconds later
    expect(store.current.has(key)).toEqual(false)
    expect(store.previous.has(key)).toEqual(true)

    await store.increment(key)
    expect(store.current.has(key)).toEqual(true)
    expect(store.previous.has(key)).toEqual(false)
  })

  it('does not allow client object to be assigned to two keys', async () => {
    const store = new MemoryStore()
    const key1 = 'test-key1'
    const key2 = 'test-key2'
    store.init({ windowMs: min } as Options)

    await store.increment(key1)
    jest.advanceTimersByTime(100)
    await store.increment(key1)
    await store.increment(key2)
    let returnValue1 = await store.increment(key1)
    expect(returnValue1.totalHits).toBe(3)

    const returnValue3 = await store.increment('key3')
    expect(returnValue1).not.toBe(returnValue3)
    expect(returnValue3.totalHits).toBe(1)

    returnValue1 = await store.increment(key1)
    expect(returnValue1.totalHits).toBe(4)  // Should be a 4, 2 would mean there's a reuse bug
  })
})
