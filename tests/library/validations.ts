// Testing validation.ts for strict configuration rules
import {
  it,
  beforeEach,
  jest,
  describe,
  expect,
} from "@jest/globals"
import { getValidations, Validations } from "../../src/validations"
import { Logger, Options, Store } from "../../src/types"
import { MemoryStore } from '../../src/memory-store'
import { ipKeyGen } from '../../src/ip-key-gen'
import express from 'express'
import supertest from "supertest"

describe("validation tests", () => {
  let validations: Validations
  let logger: Logger

  beforeEach(() => {
    logger = {
      warn: jest.fn(),
      error: jest.fn(),
    }

    validations = getValidations(true, logger)
  })

  describe("disable", () => {
    it("should initialize disabled when passed false", () => {
      const disabledValidator = getValidations(false, logger)
      disabledValidator.ip("badip")
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("should do nothing after `disable() is called`", () => {
      validations.disable()
      validations.ip("badip")
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe("ip", () => {
    it("should allow a valid IPv4", () => {
      validations.ip("1.2.2.1")
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("should log an error for an invalid IP", () => {
      validations.ip("1.2.3")
      expect(logger.error).toHaveBeenCalled()

      validations.ip("grrr")
      expect(logger.error).toHaveBeenCalled()

      validations.ip("1.2.3.4.5")
      expect(logger.error).toHaveBeenCalled()
    })

    it("should allow a valid IPv6", () => {
      validations.ip("1200:0000:AB00:1234:0000:2552:7777:1111")
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("should log an error for an undefined IP", () => {
      validations.ip(undefined)
      expect(logger.error).toHaveBeenCalled()
    })

    it("should log an error for an IPv6 with a port", () => {
      validations.ip("[1200:0000:AB00:1234:0000:2552:7777:1313]:1234")
      expect(logger.error).toHaveBeenCalled()
    })

    it("should log an error for an IPv4 with a port", () => {
      validations.ip("1.2.3.4:1234")
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe("trustProxy", () => {
    it('should log an error on "trust proxy" set to true', () => {
      validations.trustProxy({ app: { get: () => true } } as any) // Mock object that returns get true function to turn on trustProxy
      expect(logger.error).toHaveBeenCalled() // Should error because trustProxy is bad, read commments in src/validations.ts for more information
    })

    it.each([false, "1.2.3.4", /1.2.3.4/, ["1.2.3.4"]])(
      'should not log an error on "trust proxy" = %s',
      (val) => {
        validations.trustProxy({ app: { get: () => val } } as any)
        expect(logger.error).not.toHaveBeenCalled()
      },
    )
  })

  describe("xForwardedFor", () => {
    it.each([
      [{ "x-forwarded-for": "1.2.3.4" }, true],
      [{}, false],
      [{}, true],
    ])(
      'should log an error with x-forwarded-for header and "trust proxy" is %s',
      (headers, trustProxy) => {
        validations.xForwardedForHeader({
          app: { get: () => trustProxy },
          headers,
        } as any)
        expect(logger.error).not.toHaveBeenCalled()
      },
    )

    it('should log an error with x-forwarded-for header and "trust proxy" is false', () => {
      validations.xForwardedForHeader({
        app: { get: () => false },
        headers: { "x-forwarded-for": "1.2.3.4" },
      } as any)
      expect(logger.error).toHaveBeenCalled()
    })
  })

  describe("forwardedHeader", () => {
    // Simulates a normal non proxy direct request raw client IP
    it("should not log an error when the forwarded header is unset", () => {
      // Passing in a fake request object
      validations.forwardedHeader({
        headers: {},
        ip: "1.2.3.4",
        // Remote address is the IP address of the machine that made the direct TCP connection to the server
        socket: { remoteAddress: "1.2.3.4" },
      } as any)
      expect(logger.error).not.toHaveBeenCalled()
    })

    // Simulates a suspicious proxy directed request forwarded ip is spoofed and by an untrusted header, thus must be ignored and look at just the `req.ip`
    it("should log an error when the forwarded header is set", () => {
      validations.forwardedHeader({
        headers: { forwarded: "1.1.1.1" },
        ip: "1.2.3.4",
        socket: { remoteAddress: "1.2.3.4" },
      } as any)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ code: "CRL_ERR_FORWARDED_HEADER" }),
      )
    })

    // Heuristic test for when a forwarded header is present, but Express's `req.ip` looks like the raw socket IP
    it("should not log an error when `req.ip` has been set to a non-default value", () => {
      validations.forwardedHeader({
        headers: { forwarded: "1.1.1.1" },
        ip: "1.1.1.100",
        socket: { remoteAddress: "1.1.1.2" },
      } as any)
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe("positiveHits", () => {
    it("should log an error if hits is non-numeric", () => {
      validations.positiveHits(true)
      expect(logger.error).toHaveBeenCalled()
    })

    it("should log an error if hits is <1", () => {
      validations.positiveHits(-1)
      expect(logger.error).toHaveBeenCalled()

      validations.positiveHits(0)
      expect(logger.error).toHaveBeenCalled()
    })

    it("should log an error if hits is not an integer", () => {
      validations.positiveHits("0")
      expect(logger.error).toHaveBeenCalled()
    })

    it("should not log an error if hits is a positive integer", () => {
      validations.positiveHits(1)
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe("uniqueStorePerLimiter", () => {
    let validations2: Validations

    beforeEach(() => {
      // Make a second instance
      validations2 = getValidations(true, logger)
    })

    it("should log an error if a store instance is used in two limiters", () => {
      const store = { localKeys: true } // Keys incremented only effects that instance and not multiple

      validations.uniqueStorePerLimiter(store as Store)
      expect(logger.error).not.toHaveBeenCalled()

      validations2.uniqueStorePerLimiter(store as Store)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_STORE_REUSE",
        }),
      )
    })

    it("should log a different error for stores without localKeys set to true", () => {
      const store = { localKeys: false }

      validations.uniqueStorePerLimiter(store as Store)
      expect(logger.error).not.toHaveBeenCalled()

      validations2.uniqueStorePerLimiter(store as Store)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_STORE_REUSE",
          message: expect.stringContaining("unique prefix"),
        }),
      )
    })

    it("should not log an error if multiple store instances are used", () => {
      const store1 = { localKeys: true }
      const store2 = { localKeys: true }

      validations.uniqueStorePerLimiter(store1 as Store)
      validations.uniqueStorePerLimiter(store2 as Store)
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe("singleCount", () => {
    class TestExternalStore {
      prefix?: string
    }
    let validations2: Validations
    beforeEach(() => {
      validations2 = getValidations(true, logger)
    })

    it("should log an error if a request is double-counted with a MemoryStore", () => {
      const req = {}
      const store = { localKeys: true }
      const key = "1.2.3.4"

      validations.singleCount(req as any, store as Store, key)
      expect(logger.error).not.toHaveBeenCalled()
      validations2.singleCount(req as any, store as Store, key)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_DOUBLE_COUNT",
          message: expect.stringContaining("incremented more than once"),
        }),
      )
    })

    it("should not log an error if a request is double-counted with more than 1 instances of a MemoryStore", () => {
      const req = {}
      const store1 = { localKeys: true }
      const store2 = { localKeys: true }
      const key = "1.2.3.4"

      validations.singleCount(req as any, store1 as Store, key)
      validations2.singleCount(req as any, store2 as Store, key)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("should log an error if a request is double-counted with an external store", () => {
      const req = {}
      const store = new TestExternalStore()
      const key = "1.2.3.4"

      validations.singleCount(req as any, store as Store, key)
      expect(logger.error).not.toHaveBeenCalled()
      validations2.singleCount(req as any, store as Store, key)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_DOUBLE_COUNT",
        }),
      )
    })

    it("should log an error if a request is double-counted with separate instances of an external store", () => {
      const req = {}
      const store1 = new TestExternalStore()
      const store2 = new TestExternalStore()
      const key = "1.2.3.4"

      validations.singleCount(req as any, store1 as Store, key)
      validations2.singleCount(req as any, store2 as Store, key)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_DOUBLE_COUNT",
        }),
      )
    })

    it("should not log an error for multiple requests from the same key", () => {
      const req1 = {}
      const req2 = {}
      const store = { localKeys: true }
      const key = "1.1.1.1"

      validations.singleCount(req1 as any, store as Store, key)
      expect(logger.error).not.toHaveBeenCalled()
      validations2.singleCount(req2 as any, store as Store, key)
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("should not log an error if a request is double-counted with separate instances of an external store with different prefixes", () => {
      const req = {}
      const store1 = new TestExternalStore()
      store1.prefix = "s1"
      const store2 = new TestExternalStore()
      store2.prefix = "s2"
      const key = "1.2.3.4"

      validations.singleCount(req as any, store1 as Store, key)
      expect(logger.error).not.toHaveBeenCalled()
      validations.singleCount(req as any, store2 as Store, key)
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe("headersDraftVersion", () => {
    it("should log an error if standardHeaders version provided is not supported", () => {
      const version = "draft-5"

      validations.headersDraftVersion(version)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_HEADERS_UNSUPPORTED_DRAFT_VERSION",
        }),
      )
    })

    it.each(["draft-6", "draft-7", "draft-8"])(
      "should not log an error for standardHeaders version %s is supported",
      (version) => {
        validations.headersDraftVersion(version)
        expect(logger.error).not.toHaveBeenCalled()
        expect(logger.warn).not.toHaveBeenCalled()
      },
    )
  })

  describe("headersResetTime", () => {
    it("should log an error if resetTime is not provided", () => {
      validations.headersResetTime(undefined)
      expect(logger.error).toHaveBeenCalled()
    })

    it("should not log an error if resetTime is provided", () => {
      validations.headersResetTime(new Date())
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe("knownOptions", () => {
    it("should log an error if an unkown option is passed in", () => {
      validations.knownOptions({ maxDelay: 100 } as any)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_UNKNOWN_OPTION_IN_CONFIG",
        }),
      )
    })

    it.each([
      { windowMs: 199 },
      { limit: 10 },
      { message: "test" },
      { statusCode: 300 },
      { requestPropertyName: "test-name" },
      { legacyHeaders: true },
      { standardHeaders: "draft-6" },
      { identifier: "" },
      { skipFailedRequests: true },
      { skipSuccessfulRequests: true },
      { skip: true },
      { keyGen: () => 10 },
      { handler: () => true },
      { reqSuccessful: () => true },
      { passOnStoreError: true },
      { store: undefined },
      { validate: true },
      { logger: undefined },
      { ipv6Subnet: 56 },
    ])("should not log an error with %s option passed in", (option) => {
      validations.knownOptions(option as any)
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe("validationsConfig", () => {
    it("should log an error if an unknown validation is disabled", () => {
      validations = getValidations({ invalid: false } as any, logger)
      validations.validationsConfig()
      expect(logger.error).toHaveBeenCalled()
    })

    it("should log an error if an unknown validation is enabled", () => {
      validations = getValidations({ invalid: true } as any, logger)
      validations.validationsConfig()
      expect(logger.error).toHaveBeenCalled()
    })

    it("should not run validations if disabled by config", () => {
      // Lay a trap invalid is a known invalid option, so logger shouldn't error if `validationsConfig=false` and works properly
      validations = getValidations(
        { invalid: false, validationsConfig: false } as any,
        logger,
      )
      validations.validationsConfig()
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("should not run validations if disabled by default", () => {
      validations = getValidations(
        { invalid: false, default: false } as any,
        logger,
      )
      validations.validationsConfig()
      expect(logger.error).not.toHaveBeenCalled()
    })

    it("should run validations if enabled by config with default is false", () => {
      validations = getValidations(
        {
          invalid: false,
          validationsConfig: true,
          default: false,
        } as any,
        logger,
      )
      validations.validationsConfig()
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: "CRL_ERR_UNKNOWN_VALIDATION",
        }),
      )
    })
  })

  describe('creationStack', () => {
    it('should log an error if called in an express request handler with a memory store', async () => {
        // Whip up basic express app and memory store to use
        const app = express()
        const store = new MemoryStore()

        // Make a get API to the mock app and initialize the store by using the `creationStack` method,
        // so the store gets created internally in the request
        app.get('/', (_req, res) => {
            validations.creationStack(store)
            res.send('hello')
        })

        // Make a request to the app using supertest and we expect a valid response
        await supertest(app).get('/').expect('hello')
        // But we do not want the ability to create memory stores inside of requests as that could be dangerous
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'CRL_ERR_CREATED_IN_REQUEST_HANDLER',
                message: expect.stringContaining('instance should be created at app init')
            })
        )
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it('should log a different error when used with an external store', async () => {
        const app = express()
        const store: Store = { localKeys: false } as any  // i.e. Redis database async/await needed

        app.get('/', (_req, res) => {
            validations.creationStack(store)
            res.send('hello')
        })

        await supertest(app).get('/').expect('hello')
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'CRL_ERR_CREATED_IN_REQUEST_HANDLER',
                message: expect.stringContaining('when responding to a request')
            })
        )
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it('should not log an error if called anywhere else', () => {
        const store = new MemoryStore()

        validations.creationStack(store)
        expect(logger.error).not.toHaveBeenCalled()
        expect(logger.warn).not.toHaveBeenCalled()
    })
  })

  describe('ipv6Subnet', () => {
    const validValues = []
    for (let i = 32; i <= 64; i++) validValues.push(i)

    it('should log an error if given an improper IPv6 subnet parameter, <32', () => {
        validations.ipv6Subnet(10)
        expect(logger.error).toHaveBeenCalled()
    })

    it('should log an error if given an improper IPv6 subnet parameter, >64', () => {
        validations.ipv6Subnet(70)
        expect(logger.error).toHaveBeenCalled()
    })

    it.each(validValues)('should not log an error if given proper IPv6 subnet parameter %s', (value) => {
        validations.ipv6Subnet(value)
        expect(logger.error).not.toHaveBeenCalled()
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it('should allow false', () => {
        validations.ipv6Subnet(false)
        expect(logger.error).not.toHaveBeenCalled()
        expect(logger.warn).not.toHaveBeenCalled()
    })

    it('should error on non-integer inputs', () => {
        validations.ipv6Subnet(53.6)
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'CRL_ERR_IPV6_SUBNET',
            })
        )
    })

    it('should error on undefined', () => {
        validations.ipv6Subnet(undefined)
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({
                code: 'CRL_ERR_IPV6_SUBNET',
            })
        )
        expect(logger.warn).not.toHaveBeenCalled()
    })
  })

  describe('keyGeneratorIpFallback', () => {
    it('should skip if keyGen is undefined', () => {
      validations.keyGeneratorIpFallback(undefined)
      expect(logger.error).not.toHaveBeenCalled()
      expect(logger.warn).not.toHaveBeenCalled()
    })

    it('should not warn on that `keyGen` that does not use `req.ip` or `request.ip`', () => {
      // Basic keyGen function that extracts API key from URL params, effectively ignoring req.ip 
      const keyGen = (req: any, _res: any): string => req.params.apikey as string
      validations.keyGeneratorIpFallback(keyGen)
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('should throw a validation error if a `keyGen` uses req.ip', () => {
      const keyGen = (req: any, _res: any): string => req.ip as string
      validations.keyGeneratorIpFallback(keyGen)
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CRL_ERR_KEY_GEN_IPV6',
        })
      )
    })

    it('should not throw a validation error on a `keyGen` that uses `request.ip` and `ipKeyGenerator`', () => {
      validations.keyGeneratorIpFallback(
        (req: any, _res: any): string => (req.params.apikey as string) || ipKeyGen(req.ip)
      )
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })
  })

  describe('windowMs', () => {
    it('should not warn on in-range value', () => {
      validations.windowMs(10 * 60 * 1000)
      expect(logger.warn).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()
    })

    it('should error on out-range value', () => {
      validations.windowMs(10000000 * 60 * 1000)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CRL_ERR_WINDOW_MS',
        })
      )
    })

    it('should error on `windowMs = 0`', () => {
      validations.windowMs(0)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CRL_ERR_WINDOW_MS',
        })
      )
    })

    it('should error on `windowMs = -1`', () => {
      validations.windowMs(-1)
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'CRL_ERR_WINDOW_MS',
        })
      )
    })
  })

  
})
