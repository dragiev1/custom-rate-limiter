//  Tests the rate limiter

import rateLimit, {
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from "../src/app"
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals"

//  Set up Jest to make fake timers before each test
describe("middleware test", () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })
})

//  Mimics a database connection or a JS Map or object for testing
class MockStore implements Store {
  initWasCalled = false
  incrementWasCalled = false
  decrementWasCalled = false
  resetKeyWasCalled = false
  getWasCalled = false
  resetAllWasCalled = false

  counter = 0
  windowMs = 0

  init(options: Options): void {
    this.initWasCalled = true
    this.windowMs = options.windowMs
  }

  //  Internal methods for changing values inside the MockStore
  async get(_key: string): Promise<ClientRateLimitInfo> {
    this.getWasCalled = true

    return { totalHits: this.counter, resetTime: undefined }
  }

  async inc(_key: string): Promise<ClientRateLimitInfo> {
    this.counter += 1
    this.incrementWasCalled = true

    return {
      totalHits: this.counter,
      resetTime: new Date(Date.now() + this.windowMs),
    }
  }

  async dec(_key: string): Promise<void> {
    this.counter -= 1
    this.decrementWasCalled = true
  }

  async resetKey(_key: string): Promise<void> {
    this.resetKeyWasCalled = true
  }

  async resetAll(): Promise<void> {
    this.resetAllWasCalled = true
  }
}

//  Store specifically for throwing errors
class StoreThrowErrors implements Store {
  init(_options: Options): void {}

  async get(_key: string): Promise<ClientRateLimitInfo> {
    throw new Error("Mock error!")
  }

  async inc(_key: string): Promise<ClientRateLimitInfo> {
    throw new Error("Mock error!")
  }

  async dec(_key: string): Promise<void> {}

  async resetKey(_key: string): Promise<void> {}

  async resetAll(): Promise<void> {}
}

//  Jest's it function for setting global single test cases
it("should not modify the options object passed", () => {
  const options = {}
  rateLimit(options)
  expect(options).toStrictEqual({})
})

it("should call `init` even if no requests have came in", async () => {
  const store = new MockStore()
  rateLimit({
    store,
  })

  expect(store.initWasCalled).toEqual(true)
})


