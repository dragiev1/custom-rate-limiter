//  Tests the rate limiter
import rateLimit, {
  Logger,
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


//  Starting point of middleware tests
describe("middleware test", () => {
  //  Lifecycle Hooks
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
  })
  
  //  Mock Stores
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
  it("custom-rate-limiter/middleware.ts: should not modify the options object passed", () => {
    const options = {}
    rateLimit(options)
    expect(options).toStrictEqual({})
  })
  
  it("custom-rate-limiter/middleware.ts: should call `init` even if no requests have came in", async () => {
    const store = new MockStore()
    rateLimit({
      store,
    })
  
    expect(store.initWasCalled).toEqual(true)
  })
  
  
  describe('custom-rate-limiter/middleware.ts: async store initalization', () => {
    let logger: Logger
  
    beforeEach(() => {
      logger = {
        error: jest.fn(),
        warn: jest.fn(),
      }
      jest.useRealTimers()
    })
  
    /**
     * If rate limiter uses await when initializing the store
     */
    class MockStoreAsyncInitResolving extends MockStore {
      initWasCalled = false
  
      init(_options: Options): Promise<void> {
        this.initWasCalled = true
        return Promise.resolve()
      }
    }
  
    /**
     * If rate limiter properly handles database connectivity errors
     */
    class MockStoreAsyncInitRejecting extends MockStore {
      initWasCalled = false
  
      init(_options: Options): Promise<void> {
        this.initWasCalled = true
        return Promise.reject(new Error('custom-rate-limiter/middleware.ts: Async init error'))
      }
    }
  
    it('custom-rate-limiter/middleware.ts: should handle resolving async init', async () => {
      // Arrange
      const store = new MockStoreAsyncInitResolving()
      const limiter = rateLimit({
        store,
        logger,
      })
  
      // Act
      await new Promise((resolve) => process.nextTick(resolve))
  
      // Assert
      expect(limiter).not.toBeInstanceOf(Promise)  // Makes sure rate limit is not a promise to avoid devs needing to use `await` when using limiter
      expect(store.initWasCalled).toEqual(true)  // Makes sure store was initialized in the first place
      expect(logger.error).not.toHaveBeenCalled()  // Checks to see if any errors occurred
    })
    
  
    
  })
  
  
  describe('custom-rate-limiter/middleware.ts: logger set', () => {
    let logger: Logger
    
    // TODO: Finish the rest of this section of tests regarding the logger.
  })
})