//  Integration/Unit tests for the rate limiter
import { createServer } from "../tests/create-server.ts"
import HTTP from 'node:http'
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
import { AddressInfo } from "node:net"
import { EventEmitter } from "node:stream"
import expectCookies from "supertest/lib/cookies"


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

  // Note: default headers are following draft-6
  it('should calculate how many hits are left', async () => {
    const app = createServer(rateLimit({ limit: 2 }))

    await request(app)
      .get('/')
      .expect(200)
      .expect('rate-limit', '2')
      .expect('rate-remaining', '1')
      .expect((res) => {
        if('retry-after' in res.headers) 
          throw new Error(
            `Expected no retry-after header, got ${res.headers['retry-after']}.`,
          )
      })
  })

  it('should call `increment` with the store', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({ store }))
    await request(app).get('/')
    expect(store.incrementWasCalled).toEqual(true)
  })

  it('should call `resetKey` with the store', async () => {
    const store = new MockStore()
    const limiter = rateLimit({
      store,
    })
    limiter.resetKey('key')
    expect(store.resetKeyWasCalled).toEqual(true)
  })

  it('should call `get` on the store', async () => {
    const store = new MockStore()
    const limiter = rateLimit({ store })
    
    const res = await limiter.getKey('key')

    expect(store.getWasCalled).toEqual(true)
    expect(typeof res?.totalHits).toBe('number')
  })

  it('should throw error if `get` does not exist on the store', async () => {
    const store = new MockStore()
    const limiter = rateLimit({ store })

    expect(limiter.getKey).toThrow()
  })

  // Ex: login attempts. If successful, then don't count it because there is no need
  it('should `decrement` when requests succeed and `skipSuccessfulRequests` is true', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({ 
      skipSuccessfulRequests: true,
      store,
    }))

    await request(app).get('/'),expect(200)
    expect(store.decrementWasCalled).toEqual(true)
  })

  // Store should catch the 200 response and immediately decrement the hit since skipping the successful requests setting is on
  it('should `decrement` hits when request finishes before `resetTime` with `skipSuccessfulRequests', async () => {
    const store = new MockStore()
    const app = createServer([
      rateLimit({
        skipSuccessfulRequests: true,
        limit: 2,
        windowMs: 300,
        store,
      }),
      (req_, res_, next) => {
        setTimeout(next, 15),
        jest.runAllTimers()
      },
    ])

    await request(app).get('/').expect(200)
    expect(store.decrementWasCalled).toEqual(true)
  })

  /* Skip successful requests tests */

  it('should not `decrement` hits when requests finishes after `resetTime` with `skipSuccessfulRequests', async () => {
    const store = new MockStore()
    const app = createServer([
      rateLimit({
        windowMs: 600,
        store,
        skipSuccessfulRequests: true,
      }),
      (_req, _res, next) => {
        setTimeout(next, 620)
        jest.runAllTimers()
      },
    ])

    await request(app).get('/').expect(200)
    expect(store.decrementWasCalled).toEqual(false)
  })

  it('should not `decrement` hits when requests fail and `skipSuccessfulRequests` is true', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      windowMs: 250,
      store,
      skipSuccessfulRequests: true,
    }))

    await request(app).get('/error').expect(400)
    expect(store.decrementWasCalled).toEqual(false)
  })

  it('should `decrement` hits when requests succeed, `skipSuccessfulRequests` is true and custom `requestWasSuccessful` method is used', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      limit: 3,
      windowMs: 40,
      skipSuccessfulRequests: true,
      reqSuccessful: (_req, res) => res.statusCode === 200,
    }))

    await request(app).get('/').expect(200)
    expect(store.decrementWasCalled).toEqual(true)
  })


  it('should not `decrement` hits when requests fail, `skipSuccessfulRequests` is true, and custom `requestWasSuccessful` method is used', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipSuccessfulRequests: true,
      reqSuccessful: (_req, res) => res.statusCode === 200,
      store,
    }))

    await request(app).get('/error').expect(400)
    expect(store.decrementWasCalled).toEqual(false)
  })

  it('should `decrement` hits when requests succeed, `skipSuccessfulRequests` is true, and custom `reqSuccessful` is used', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipSuccessfulRequests: true,
      reqSuccessful: (req, _res) => req.query.success === '1',
      store,
    }))

    await request(app).get('/?success=1')
    expect(store.decrementWasCalled).toEqual(true)
  })

  it('should not `decrement` hits when requests fail, `skipSuccessfulRequests` is true, and custom `reqSuccessful` is used', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipSuccessfulRequests: true,
      reqSuccessful: (req, _res) => req.query.success === '1',
      store, 
    }))

    await request(app).get('/?success=0')
    expect(store.decrementWasCalled).toEqual(false)
  })


  /* Skip failed requests tests */

  it('should `decrement` hits when requests fail, `skipFailedRequests` is set to true', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipFailedRequests: true,
      store,
    }))

    await request(app).get('/error').expect(400)
    expect(store.decrementWasCalled).toEqual(true)
  })

  it('should not `decrement` hits requests succeed, `skipFailedRequests` is set to true', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipFailedRequests: true,
      store,
    }))

    await request(app).get('/').expect(200)
    expect(store.decrementWasCalled).toEqual(false)
  })

  it('should `decrement` hits requests fail, `skipFailedRequests` is set to true, and custom `reqSuccessful` is used', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipFailedRequests: true,
      reqSuccessful: async () => false,
      store,
    }))

    await request(app).get('/error').expect(400)
    expect(store.decrementWasCalled).toEqual(true)
  })

  /**
   * Tests to see if the middleware prevents penalizations of when users disconnect abruptly on accident.
   * In English what is happening here:
   * Creates an express app with rate limiter + real clock.
   * Start server and listen to random port, await listening to pause test until server is fully booted.
   * Use `HTTP.get` to send a request to /hang-server.
   * Server catches request and fire `recieved` function; resolving `connectionOpened` Promise.
   * `connectionOpened` resolves.
   * Server does nothing.
   * `hangRequest.destroy()` called to simulate user closing their browser mid-request.
   * Node.js request object realizes socket is dead, then fire close event, triggering `closed()`; resolving `connectionClosed` Promise.
   * Test unpauses past `await connectionClosed`.
   * Shut down server.
   * Assert:
   *      Store decremented hit count.
   *      HTTP response was sent by server and `responseHandler` (error) was not called.
   * End of test.
   */
  it('should `decrement` hits when response closes and `skipFailedRequests` is true (server)', async () => {
    jest.useRealTimers()
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipFailedRequests: true,
      store,
    }))

    //  Deferred promise pattern
    let recieved: () => void
    const connectionOpened = new Promise<void>((resolve) => {
      recieved = resolve
    })
    let closed: () => void
    const connectionClosed = new Promise<void>((resolve) => {
      closed = resolve
    })

    app.get('/hang-server', (req, _res) => {
      recieved()
      // When request closes, call closed
      req.on('close', closed)
    })

    // Creating an actual HTTP server request here due to Node.js .timeout() not working here anymore
    let setListening: () => void
    const listening = new Promise<void>((resolve) => {
      setListening = resolve
    })
    const listener = app.listen((err) => {
      if(err) {
        console.error('Error starting the server:', err)
        throw err
      }
      setListening()
    })
    listener.unref()  //  Let the procress exit if the test fails
    await listening

    const { address, port } = listener.address() as AddressInfo
    expect(address).toBeDefined()
    expect(port).toBeDefined

    const responseHandler = jest.fn()
    const hangRequest = HTTP.get(
      `http://[${address}]:${port}/hang-server`,
      responseHandler,
    )

    await connectionOpened

    hangRequest.on('error', (_err) => {
      // Expected, but if we do not add a listener, the test errors out
    })
    hangRequest.destroy()

    await connectionClosed
    listener.close()  // Shutdown server

    expect(store.decrementWasCalled).toEqual(true)
    expect(responseHandler).not.toHaveBeenCalled()  // True means server responded to something going wrong
  })


  // Unit test for when a response closed abruptly to simulate a user losing connection
  it('should `decrement` hits when response closes and `skipFailedRequests` is true (middleware)', async () => {
    const store = new MockStore()
    const middleware = rateLimit({
      skipFailedRequests: true,
      store,
    })

    const mockedReq = {
      ip: '127.0.0.1',
      method: 'GET',
      path: '/',
      url: '/',
      headers: {},
      app: { get: () => false},
    } as unknown as Request  //  Avoid pointless attributes required in a Request object

    const mockedRes = Object.assign(new EventEmitter(), {
      statusCode: 200,
      writableEnded: false,  //  This means the response never fully made it to client
      setHeader: jest.fn(),
      getHeader: jest.fn(),
      end: jest.fn(),
    }) as unknown as Response  //  Avoid pointless attributes required in a Response object

    const next = jest.fn()

    // Start middleware to wait for it to finish setting up
    const middlewarePromise = middleware(mockedReq, mockedRes, next)

    // Simulate the connection closing before the response finishes
    mockedRes.emit('close')

    // Wait for the middleware to finish processing
    await middlewarePromise

    expect(store.decrementWasCalled).toEqual(true)
  })


  it('should `decrement` hits when response emits an error and `skipFailedRequests` is true', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      skipFailedRequests: true,
      store,
    }))

    await app.get('/crash')

    expect(store.decrementWasCalled).toEqual(true)
  })

  it('should `decrement` hits when limit is reached and `skipFailedRequests` is true', async () => {
    const store = new MockStore()
    const app = createServer(rateLimit({
      limit: 2,
      skipFailedRequests: true,
      store,
    }))

    await app.get('/').expect(200)
    await app.get('/').expect(200)
    await app.get('/').expect(429)

    expect(store.decrementWasCalled).toEqual(true)
  })


  // Handler tests

  it('should forward errors in the handler using `next()`', async () => {
    let errorCaught = false
    
    const store = new MockStore()
    const app = createServer(rateLimit({
      store,
      limit: 1,
      handler() {
        const exception = new Error('420: Mock Error')
        throw exception
      },
    }))

    // Only will run if Express recieves an error
    app.use((
      error: Error,
      _req: Request,
      res: Response,
      _next: NextFunction,
    ) => {
      errorCaught = true
      res.status(500).send(error.message)
    })

    await request(app).get('/').expect(200)
    await request(app).get('/').expect(500)

    expect(errorCaught).toEqual(true)
  })


  it('should pass the number of hits and the limit to the next request handler in the `request.rateLimit` property', async () => {
    let savedRequestObject: any
    const saveRequestObject = (
      req: Request,
      _res: Response,
      next: NextFunction,
    ) => {
      savedRequestObject = req
      next()
    }

    const app = createServer([
      saveRequestObject,
      rateLimit({
        legacyHeaders: false,
        limit: 6,
      })
    ])

    await request(app).get('/').expect(200)
    expect(savedRequestObject?.rateLimit).toMatchObject({
      limit: 6,
      used: 1,
      remaining: 5,
      resetTime: expect.any(Date),
    })

    expect(savedRequestObject?.rateLimit.current).toBe(1)

    savedRequestObject = undefined  // Remove old request object for new one
    await request(app).get('/').expect(200)
    expect(savedRequestObject?.rateLimit).toMatchObject({
      limit: 6,
      used: 2,
      remaining: 4,
      resetTime: expect.any(Date),
    })
    expect(savedRequestObject?.rateLimit.current).toBe(2)
  })


  it('should handle two rate-limiters with different `requestPropertyName` working independently', async () => {
    const keyLimiter = rateLimit({
      limit: 2,
      requestPropertyName: 'rateLimitKey',
      keyGen: (req) => req.query.key as string,
      handler(_req, res) {
        res.status(420).end('Test')
      },
    })

    const globalLimiter = rateLimit({
      limit: 5,
      requestPropertyName: 'rateLimitGlobal',
      keyGen: () => 'global',
      handler(_req, res) {
        res.status(429).end('Too many requests')
      }
    })

    let savedRequestObj: any
    const saveRequestObject = (
      req: Request,
      _res: Response,
      next: NextFunction,
    ) => {
      savedRequestObj = req
      next()
    }

    // Create the mock server with all the limiters plus the request tracker
    const app = createServer([saveRequestObject, keyLimiter, globalLimiter])

    await request(app).get('/').query({ key: 1 }).expect(200)

    expect(savedRequestObj).toBeTruthy()
    // Check if the library did not already use the default property name
    expect(savedRequestObj.rateLimit).toBeUndefined()

    // Key 
    expect(savedRequestObj.rateLimitKey).toBeTruthy()
    expect(savedRequestObj.rateLimitkey.limit).toEqual(2)
    expect(savedRequestObj.rateLimitkey.remaining).toEqual(1)

    // Global
    expect(savedRequestObj.rateLimitGlobal).toBeTruthy()
    expect(savedRequestObj.rateLimitGlobal.limit).toEqual(5)
    expect(savedRequestObj.rateLimitGlobal.remaining).toEqual(4)
    

    savedRequestObj = undefined 
    await request(app).get('/').query({ key: 2 }).expect(200)  // Query as new user
    expect(savedRequestObj.rateLimitKey.remaining).toEqual(1)  // Make sure key limiter is different than key = 1
    expect(savedRequestObj.rateLimitGlobal.remaining).toEqual(3)  // Make sure global limiter is still decrementing

    
    savedRequestObj = undefined
    await request(app).get('/').query({ key: 1 }).expect(200)
    expect(savedRequestObj.rateLimitKey.remaining).toEqual(0)
    expect(savedRequestObj.rateLimitGlobal.remaining).toEqual(2)

    savedRequestObj = undefined
    await request(app).get('/').query({ key: 2 }).expect(200)
    expect(savedRequestObj.rateLimitKey.remaining).toEqual(0)
    expect(savedRequestObj.rateLimitGlobal.remaining).toEqual(1)

    savedRequestObj = undefined
    await request(app).get('/').query({ key: 1 }).expect(420, 'Too many requests')  // Check if global limiter limited the request!
    expect(savedRequestObj.rateLimitKey.remaining).toEqual(0)

    savedRequestObj = undefined
    await request(app).get('/').query({ key: 3 }).expect(420, 'Too many requests')
    expect(savedRequestObj.rateLimitKey.remaining).toEqual(0)
    expect(savedRequestObj.rateLimitGlobal.remaining).toEqual(0)

    savedRequestObj = undefined
  })


  it('', async () => {})


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