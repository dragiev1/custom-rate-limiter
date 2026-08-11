// Rate limit middleware
import { Request, Response, NextFunction } from "express"
import createDebugLogger from "debug"
import {
  AugmentedRequest,
  DraftHeadersVersion,
  EnabledValidations,
  Logger,
  Options,
  RateLimitExceededEventHandler,
  RateLimitInfo,
  RateLimitRequestHandler,
  Store,
  ValueDeterminingMiddleware,
} from "./types"
import { ConsoleLogger } from "./console-logger"
import { MemoryStore } from "./memory-store"
import { ipKeyGen } from "./ip-key-gen"
import { isIPv6 } from "node:net"
import {
  setDraft6Headers,
  setDraft7Headers,
  setDraft8Headers,
  setLegacyHeaders,
} from "./headers"
import { getValidations, type Validations } from "./validations"

/**
 * Dupe object of Options purely for type safety and the developer's experience.
 * Every property is guaranteed to have a default value.
 */
type Configuration = {
  windowMs: number
  limit: number | ValueDeterminingMiddleware<number> // Value can be static or from custom method made by developer
  message: any | ValueDeterminingMiddleware<any>
  statusCode: number
  requestPropertyName: string
  legacyHeaders: boolean
  standardHeaders: false | DraftHeadersVersion
  identifier: string | ValueDeterminingMiddleware<string>
  skipFailedRequests: boolean
  skipSuccessfulRequests: boolean
  keyGen: ValueDeterminingMiddleware<string>
  ipv6Subnet: number | ValueDeterminingMiddleware<number> | false
  handler: RateLimitExceededEventHandler
  skip: ValueDeterminingMiddleware<boolean>
  reqSuccessful: ValueDeterminingMiddleware<boolean>
  store: Store
  passOnStoreError: boolean
  validations: Validations
  logger: Logger
}

//  IP rate limiter middleware
const rateLimit = (
  passedOptions?: Partial<Options>,
): RateLimitRequestHandler => {
  const config = parseOptions(passedOptions ?? {})
  const options = getOptionsFromConfig(config)

  const debug = createDebugLogger("custom-rate-limiter")
  debug("Initializing new rate limiter with %o", config.store.constructor.name)
  for (const [key, val] of Object.entries(config))
    debug("set %s to %o", key, val)

  // Limiter should not be created because of a request
  config.validations.creationStack(config.store)
  // Store instance should not be shared among multiple rate limiters
  config.validations.uniqueStorePerLimiter(config.store)

  //  Call store initialization method
  if (typeof config.store.init === "function") {
    try {
      debug("Starting store initalization")
      const storeInit = config.store.init(options)
      if (storeInit instanceof Promise)
        storeInit.catch((e) =>
          config.logger.error(
            e,
            "custom-rate-limiter: async error at store initialization.",
          ),
        )
    } catch (e) {
      config.logger.error(
        e,
        "custom-rate-limiter: error during initialization.",
      )
    }
  }

  // Middleware setup
  const middleware = async (
    req: Request,
    res: Response,
    next: NextFunction,
  ) => {
    //  Ignore certain requests (e.g. 500 server errors don't count)
    const errorPromise =
      config.skipFailedRequests &&
      new Promise<void>((resolve) => res.once("error", resolve))
    //  If client was disconnected before the server could finish sending
    const closePromise =
      config.skipFailedRequests &&
      new Promise<void>((resolve) => res.once("close", resolve))
    const finishPromise =
      (config.skipFailedRequests || config.skipSuccessfulRequests) &&
      new Promise<void>((resolve) => res.once("finish", resolve))

    debug("Requested to %o", req.originalUrl)
    debug("Request from ip %o", req.ip)

    //  Skip if needed
    const skip = await config.skip(req, res)
    if (skip) {
      debug("Skipping request")
      next()
      return
    }

    //  Create an augmented request
    const augmentedRequest = req as AugmentedRequest

    //  Get unique key for client
    const key = await config.keyGen(req, res)
    debug('Calculated key %o', key)

    //  Increment hit count by one
    debug('Incrementing count')
    let totalHits = 0
    let resetTime
    try {
      const incResult = await config.store.inc(key)
      //  Save local values temporarily
      totalHits = incResult.totalHits
      resetTime = incResult.resetTime
    } catch (e) {
      if (config.passOnStoreError)
        config.logger.error(
          e,
          "custom-rate-limiter: error from store, allowing request without rate-limiting.",
        )
      //  Pass error to express error handler instead of going through the rate limit
      else next(e)
      return
    }

    // Validate totalHits is positive and only increased by 1 hit and not more
    config.validations.positiveHits(totalHits)
    config.validations.singleCount(req, config.store, key)

    //  Check limit for client
    //  If limit is determined by a function, call it or just grab
    const getLimit =
      typeof config.limit === "function"
        ? config.limit(req, res)
        : config.limit
    const limit = await getLimit
    config.validations.limit(limit)

    //  Create rate limit info object for client
    const info: RateLimitInfo = {
      limit,
      hits: totalHits,
      remaining: Math.max(limit - totalHits, 0),
      resetTime,
      key,
    }

    // Display exactly which limiter is adding what value to each key
    for (const [key, val] of Object.entries(info))
      debug(
        'Set request.%s.%s to be %o',
        config.requestPropertyName,
        key,
        val
      )

    //  Set in stone the current values of info and make it readonly
    //  hidden from stringify and iteration through info objects
    Object.defineProperty(info, "current", {
      configurable: false,
      enumerable: false,
      value: totalHits,
    })

    //  Set the rate limit info on the augmented request object
    augmentedRequest[config.requestPropertyName] = info

    //  Set the 'X-RateLimit' hears on the response object if enabled
    if (config.legacyHeaders && !res.headersSent) {
      debug('Setting legacy headers')
      setLegacyHeaders(res, info)
    }

    //  Set standardized Rate-Limit headers on response object if needed
    if (config.standardHeaders && !res.headersSent) {
      switch (config.standardHeaders) {
        case "draft-6":
          debug('Setting IETF draft-6 headers')
          setDraft6Headers(res, info, config.windowMs)
          break

        case "draft-7":
          debug('Setting IETF draft-7 headers')
          config.validations.headersResetTime(info.resetTime)
          setDraft7Headers(res, info, config.windowMs)
          break

        case "draft-8":
          debug('Setting IETF draft-8 headers')
          const getName =
            typeof config.identifier === "function"
              ? config.identifier(req, res)
              : config.identifier
          const name = await getName
          debug('Set name to %o', name)
          config.validations.headersResetTime(info.resetTime)
          setDraft8Headers(res, info, config.windowMs, key, name)
          break

        default:
          config.validations.headersDraftVersion(config.standardHeaders)
          break
      }
    }

    //  Skip failed/successful requests, decrement hit accordingly
    if (config.skipFailedRequests || config.skipSuccessfulRequests) {
      let decremented = false

      //  Ensure we only decrement once per hit recorded
      //  even if multiple settings are set to true
      const decrementKey = async () => {
        if (!decremented) {
          if (resetTime && Date.now() >= resetTime.getTime()) return
          
          debug('Decrementing hit count')
          await config.store.dec(key)
          decremented = true
        }
      }

      if (config.skipFailedRequests) {
        if (finishPromise)
          void finishPromise.then(async () => {
            const success = config.reqSuccessful(req, res)
            debug("Computed reqSuccessful as %o", success)
            if (!success) await decrementKey()
          })

        if (closePromise)
          void closePromise.then(async () => {
            //  Checks if the stream was cut short
            if (!res.writableEnded) await decrementKey()
          })

        if (errorPromise)
          void errorPromise.then(async () => {
            await decrementKey()
          })
      }

      if (config.skipSuccessfulRequests) {
        if (finishPromise) {
          void finishPromise.then(async () => {
            const success = await config.reqSuccessful(req, res)
            debug("Computed reqSuccessful as %o", success)
            if (success) await decrementKey()
          })
        }
      }
    }

    if (totalHits > limit) {
      //  Client limit reached block!
      debug('Limit exceeded')
      config.handler(req, res, next, options)
      return
    }

    next()
  }

  const getThrowFn = () => {
    throw new Error(
      "Store does not support the get/getKey method.",
    )
  }

  //  Attach new prop resetKey permanently to ensure this points to correct store
  //  so user only needs the rate limiter and not store object as well
  (middleware as RateLimitRequestHandler).resetKey = config.store.resetKey.bind(
    config.store,
  )
  ;(middleware as RateLimitRequestHandler).getKey =
    typeof config.store.get === "function"
      ? config.store.get.bind(config.store)
      : getThrowFn

  return middleware as RateLimitRequestHandler
}

// Type checks and adds defaults for missing option fields
const parseOptions = (passedOptions: Partial<Options>): Configuration => {
  const definedOptions: Partial<Options> =
    omitUndefinedProperties<Partial<Options>>(passedOptions)

  const logger = passedOptions.logger ?? ConsoleLogger

  // Grab and run basic validations
  const validations = getValidations(
    definedOptions?.validate ?? true, // Run validations by default
    logger,
  )
  validations.validationsConfig()
  validations.knownOptions(passedOptions)
  if (
    definedOptions.ipv6Subnet !== undefined &&
    typeof definedOptions.ipv6Subnet !== "function"
  )
    validations.ipv6Subnet(definedOptions.ipv6Subnet)
  validations.keyGeneratorIpFallback(definedOptions.keyGen)

  let standardHeaders = definedOptions.standardHeaders ?? true // Use standard headers as default
  if (standardHeaders === true) standardHeaders = "draft-6" // Default to draft-6

  const config: Configuration = {
    windowMs: 60 * 1000, // 1 min
    limit: passedOptions.limit ?? 5,
    message: "Too many request, please try again later.",
    statusCode: 429,
    requestPropertyName: "rateLimit",
    legacyHeaders: definedOptions.legacyHeaders ?? false,

    skipFailedRequests: false,
    skipSuccessfulRequests: false,
    reqSuccessful: (req: Request, res: Response): boolean =>
      res.statusCode < 400,
    skip: (req: Request, res: Response): boolean => false,

    //  Make async to allow more complexity if wanted, otherwise it acts synchronously
    async keyGen(req: Request, res: Response): Promise<string> {
      // Validations
      validations.ip(req.ip)
      validations.trustProxy(req)
      validations.xForwardedForHeader(req)
      validations.forwardedHeader(req)

      const ip: string = req.ip!

      //  Default to 56 mask if unprovided
      let subnet: number | false = 56

      if (isIPv6(ip))
        //  Apply subnet
        subnet =
          typeof config.ipv6Subnet === "function"
            ? await config.ipv6Subnet(req, res)
            : config.ipv6Subnet

      if (typeof config.ipv6Subnet === "function")
        validations.ipv6Subnet(subnet)

      return ipKeyGen(ip, subnet)
    },
    ipv6Subnet: 56,

    identifier(req: Request, _res: Response): string {
      let duration = ""
      const property = config.requestPropertyName

      const { limit } = (req as AugmentedRequest)[property]
      const seconds = config.windowMs / 1000
      const minutes = config.windowMs / (1000 * 60)
      const hours = config.windowMs / (1000 * 60 * 60)
      const days = config.windowMs / (1000 * 60 * 60 * 24)

      if (seconds < 60) duration = `${seconds}sec`
      else if (minutes < 60) duration = `${minutes}min`
      else if (hours < 24) duration = `${hours}hrs`
      else duration = `${days}days`

      return `${limit}-in-${duration}`
    },

    //  Handles when user is rate limited
    async handler(
      req: Request,
      res: Response,
      next: NextFunction,
      optionsUsed: Options,
    ): Promise<void> {
      res.status(config.statusCode)
      //  If message is a method then call it, otherwise save the message
      const message: unknown =
        typeof config.message === "function"
          ? await (config.message as ValueDeterminingMiddleware<any>)(req, res)
          : config.message

      //  Prevents Node.js server from crashing if response already sent to client
      if (!res.writableEnded) res.send(message)
    },
    passOnStoreError: false,
    ...definedOptions, // Allow fields above to be overwritten by already defined options
    standardHeaders,
    store: definedOptions.store ?? new MemoryStore(validations), // If store does not exist, create a new one
    logger,
    validations,
  }

  //  Check that the store correctly implemented the Store interface
  if (
    typeof config.store.inc !== "function" ||
    typeof config.store.dec !== "function" ||
    typeof config.store.resetKey !== "function" ||
    (typeof config.store.resetAll !== "function" &&
      typeof config.store.resetAll !== "undefined") ||
    (typeof config.store.init !== "function" &&
      typeof config.store.init !== "undefined")
  )
    throw new TypeError(
      "Invalid store was passed. Ensure the store is a class which implements the `Store` interface.",
    )

  return config
}

// Adapter mapper function
const getOptionsFromConfig = (config: Configuration): Options => {
  const { validations, ...directlyPassableEntries } = config
  return {
    ...directlyPassableEntries,
    validate: validations.enabled as EnabledValidations,
  }
}

// Removes properties where their value is set to undefined
const omitUndefinedProperties = <T extends { [key: string]: any }>(
  passedOptions: T,
): T => {
  const omitted = {} as T

  for (const k of Object.keys(passedOptions)) {
    const key = k as keyof T

    if (passedOptions[key] !== undefined) omitted[key] = passedOptions[key]
  }

  return omitted
}

export default rateLimit
