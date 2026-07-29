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
  
  
  describe('async store initalization', () => {
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
        return Promise.reject(new Error('Async init error'))
      }
    }
  

    /**
     * Tests if the store initialized properly and that the limiter is not a Promise object
     */
    it('should handle resolving async init', async () => {
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
    it('should catch async errors thrown from store initialization method', () => {
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

  it('should let the first request through', async () => {
    const app = createServer(rateLimit({ limit: 1 }))

    await request(app).get('/').expect(200).expect('Hello!')
  })

  /**
   * Main test for rate limiting logic
   */
  it('should refuse additional connections once IP has reached limit', async () => {
    const app = createServer(rateLimit({ limit: 2 }))

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(429)
  })

  it('should accept new connections from a limit blocked IP address', async () => {
    const app = createServer(rateLimit({
      limit: 2,
      windowMs: 30,
    }))

    // Use up limit
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    // Get limited
    await request(app).get('/').expect(429)
    // Skip 60 seconds into the future
    jest.advanceTimersByTime(30)
    // Should be able to make new request
    await request(app).get('/').expect(200)
  })

  it('should work consecutively', async () => {
    const app = createServer(rateLimit({ 
      limit: 2,
      windowMs: 30,
    }))

    // Use up limit
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(429)

    jest.advanceTimersByTime(30)

    // Should be rate limited again after reset
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(429)
    
    jest.advanceTimersByTime(30)
    await request(app).get('/').expect(200)
  })

  it('should block all requests if limit is set to 0', async () => {
    const app = createServer(rateLimit({ 
      validate: { limit: false }, 
      limit: 0, 
    }))

    await request(app).get('/').expect(429)
  })

  it('should show the provided msg instead of the default msg when limit rates are reached', async () => {
    const msg = 'LIMITED, HAHA'
    const app = createServer(rateLimit({
      limit: 2,
      windowMs: 40,
      message: msg,
    }))

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(429).expect(msg)
  })

  it('should allow user to customize error status codes', async () => {
    const statusCode = 448
    const app = createServer(rateLimit({
      limit: 1,
      windowMs: 20,
      statusCode,
    }))

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(429).expect(statusCode)
  })

  it('should allow responding with a JSON msg', async () => {
    const msg = { error: { code: 'too-many-request', message: 'Too many requests were attempted at once.', }}
    const app = createServer(rateLimit({
      limit: 1,
      message: msg
    }))

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(429, msg)
  })

  it('should allow a message be a function', async () => {
    const app = createServer(rateLimit({
      limit: 1,
      message: () => 'Too many requests.',
    }))

    await request(app).get('/').expect(200, 'Hello!')
    await request(app).get('/').expect(429, 'Too many requests.')
  })

  it('should allow msg to be a function that returns a promise for dynamic msg functions', async () => {
    const app = createServer(rateLimit({
      limit: 1,
      message: async () => 'Too many requests.'
    }))

    await request(app).get('/').expect(200, 'Hello!')
    await request(app).get('/').expect(429, 'Too many requests.')
  })

  // For cases where a developer does not want to use the standard stuff the base rate limiter has
  it('should use custom handler when provided', async () => {
    const app = createServer(rateLimit({
      limit: 1,
      handler(_req, res) {
        res.status(420).end('handler test')
      },
    }))

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(420, 'handler test')
  })

  // For situations where developers want to not use IPs to rate limit, but perhaps user IDs!
  it('should allow custom key generators to be utilized', async () => {
    const app = createServer(rateLimit({
      limit: 1,
      keyGen: (req, _res) => req.query.key as string,
    }))

    await request(app).get('/').query({ key: 1 }).expect(200)
    await request(app).get('/').query({ key: 2 }).expect(200)
    await request(app).get('/').query({ key: 1 }).expect(429)
    await request(app).get('/').query({ key: 2 }).expect(429)
  })

  it('should allow custom skip function', async () => {
    const app = createServer(rateLimit({
      limit: 2,
      skip: () => true, 
    }))

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
  }) 

  it('should allow custom skip function that returns a promise', async () => {
    const app = createServer(rateLimit({
      limit: 1,
      skip: async () => true,
    }))

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
    await request(app).get('/').expect(200)
  })


  describe('logger set', () => {
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
    it('should use logger instead of the console on validation errors', async () => {
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