//  Tests the rate limiter
import { createServer } from "../tests/create-server.ts"
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
import type { Request, Response, NextFunction } from "express"
import { agent as request } from 'supertest'


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
  

    /**
     * Tests if the store initialized properly and that the limiter is not a Promise object
     */
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
      expect(store.initWasCalled).toBe(true)  // Makes sure store was initialized in the first place
      expect(logger.error).not.toHaveBeenCalled()  // Checks to see if any errors occurred
    })
    
    /**
     * Creates a mock implementation on fake store and tests if errors are properly thrown from the store
     */
    it('custom-rate-limiter/middleware.ts: should catch async errors thrown from store initialization method', () => {
      const store = new MockStore()
      jest.spyOn(store, 'init').mockImplementation(() => {
        throw new Error('test error')
      })
      const limiter = rateLimit({
        store,
        logger,
      })

      expect(limiter).not.toBeInstanceOf(Promise)
      expect(logger.error).toHaveBeenCalledWith(
        expect.any(Error),
        'custom-rate-limiter: error during store initialization.',
      )
    })
  })

  // TODO: finish tests below   
  it('custom-rate-limiter/middleware.ts: should let the first request through', () => {
    const app = createServer(rateLimit({ limit: 1 }))

    await request(app)
  })

  it('custom-rate-limiter/middleware.ts: should refuse additional connections once IP has reached limit', async () => {
    
  })

  it('custom-rate-limiter/middleware.ts: should accept new connections from a limit blocked IP address', async () => {

  })


  describe('custom-rate-limiter/middleware.ts: logger set', () => {
    let logger: Logger

    beforeEach(() => {
      logger = {
        error: jest.fn(),
        warn: jest.fn(),
      }

      jest.spyOn(console, 'error').mockImplementation(() => {})
    })


    /**
     * Tests if console threw an error because we told the library to use the custom logger
     * Makes sure that developer uses our custom logger otherwise they will not get our errors/warnings
     */
    it('custom-rate-limiter/middleware.ts: should use logger instead of the console on validation errors', async () => {
      rateLimit({
        logger,
        ipv6Subnet: 48.5,
      })

      expect(console.error).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({code:'custom-rate-limiter: IPV6_SUBNET'}),
      ) 
    })
    
    
  })
})