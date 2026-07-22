//  Tests the rate limiter

import { ClientRateLimitInfo, Options, Store } from '../src/types';
import {
  afterEach,
  beforeEach,
  describe,
  jest
} from '@jest/globals';


//  Set up Jest to make fake timers before each test
describe('middleware test', () => {
  beforeEach(() => {
    jest.useFakeTimers()
  })
  afterEach(() => {
    jest.useRealTimers()
    jest.restoreAllMocks()
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

      return {totalHits: this.counter, resetTime: undefined}
    }

    async inc(_key: string): Promise<ClientRateLimitInfo> {
      this.counter += 1
      this.incrementWasCalled = true
      
      return {
        totalHits: this.counter,
        resetTime: new Date(Date.now() + this.windowMs)
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
})

