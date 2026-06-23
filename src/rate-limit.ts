// Rate limit middleware

import { Request, Response, NextFunction } from "express";
import {
  AugmentedRequest,
  Logger,
  Options,
  RateLimitExceededEventHandler,
  RateLimitInfo,
  RateLimitReachedEventHandler,
  RateLimitRequestHandler,
  Store,
  ValueDeterminingMiddleware,
} from "./types";
import { ConsoleLogger } from "./console-logger";
import { MemoryStore } from "./memory-store";
import { ipKeyGen } from "./ip-key-gen";
import { isIPv6 } from "node:net";

//  Dupe of Options, but strictly for rate-limit.ts and has no access by the user
type Configuration = {
  windowMs: number;
  limit: number | ValueDeterminingMiddleware<number>; // Value can be static or from custom method made by developer
  message: any | ValueDeterminingMiddleware<any>;
  statusCode: number;
  requestPropertyName: string;
  skipFailedRequests: boolean;
  skipSuccessfulRequests: boolean;
  keyGen: ValueDeterminingMiddleware<string>;
  ipv6Subnet: number | ValueDeterminingMiddleware<number> | false;
  handler: RateLimitExceededEventHandler;
  skip: ValueDeterminingMiddleware<boolean>;
  reqSuccessful: ValueDeterminingMiddleware<boolean>;
  store: Store;
  passOnStoreError: boolean;
  logger: Logger;
};

//  IP rate limiter middleware
const rateLimit = (passedOptions?: Options): RateLimitRequestHandler => {
  const config = parseOptions(passedOptions ?? {});
  const options = getOptionsFromConfig(config);

  //  Call store initialization method if it exists
  if (typeof config.store.init === "function") {
    try {
      const storeInit = config.store.init(options);
      if (storeInit instanceof Promise)
        storeInit.catch((e) =>
          config.logger.error(
            e,
            "custom-rate-limiter: async error at store initialization."
          )
        );
    } catch (e) {
      config.logger.error(
        e,
        "custom-rate-limiter: error during initialization."
      );
    }
  }

  const middleware = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    //  Skip if needed
    const skip = await config.skip(req, res);
    if (skip) return next();

    //  Get unique key for client
    const key = await config.keyGen(req, res);

    //  Increment hit count by one
    let totalHits = 0;
    let resetTime;
    try {
      const incResult = await config.store.inc(key);
      //  Save local values temporarily
      totalHits = incResult.totalHits;
      resetTime = incResult.resetTime;
    } catch (e) {
      if (config.passOnStoreError)
        config.logger.error(
          e,
          "custom-rate-limiter: error from store, allowing request without rate-limiting."
        );
      //  Pass error to express error handler instead of going through the rate limit
      else next(e);
      return;
    }

    //  Check limit for client
    //  If limit is determined by a function, call it or just grab
    const getLimit =
      typeof config.limit === "function"
        ? config.limit(req, res)
        : config.limit;
    const limit = await getLimit;

    //  Create rate limit info object for client
    const info: RateLimitInfo = {
      limit,
      hits: totalHits,
      remaining: Math.max(limit - totalHits, 0),
      resetTime,
      key,
    };

    //  Set in stone the current values of info and make it readonly
    //  hidden from stringify and iteration through info objects
    Object.defineProperty(info, "current", {
      configurable: false,
      enumerable: false,
      value: totalHits,
    });

    //  Ignore certain requests (e.g. 500 server errors don't count)
    const endOfPromise =
      (config.skipFailedRequests || config.skipSuccessfulRequests) &&
      new Promise<void>((resolve) => res.once("finish", resolve));
    //  If client was disconnected before the server could finish sending
    const closePromise =
      config.skipFailedRequests &&
      new Promise<void>((resolve) => res.once("close", resolve));

    //  Skip failed/successful requests, decrement hit accordingly
    if (config.skipFailedRequests || config.skipSuccessfulRequests) {
      let decremented = false;

      //  Ensure we only decrement once per hit recorded
      //  even if multiple settings are set to true
      const decrementKey = async () => {
        if (!decremented) {
          await config.store.dec(key);
          decremented = true;
        }
      };

      if (config.skipFailedRequests) {
        if (endOfPromise)
          void endOfPromise.then(async () => {
            if (!(await config.reqSuccessful(req, res))) await decrementKey();
          }).catch((e) => {config.logger.error(e, "custom-rate-limiter: error during request cleanup.")});

        if (closePromise)
          void closePromise.then(async () => {
            //  Checks if the stream was cut short
            if (!res.writableEnded) await decrementKey();
          }).catch((e) => {config.logger.error(e, "custom-rate-limiter: error during request cleanup.")});
      }

      if (config.skipSuccessfulRequests) {
        if (endOfPromise) {
          void endOfPromise.then(async () => {
            if (await config.reqSuccessful(req, res)) await decrementKey();
          });
        }
      }
    }

    if (totalHits > limit) {
      //  Client limit reached; block!
      config.handler(req, res, next, options);
      return;
    }

    next();
  };

  const getThrowFn = () => {
    throw new Error(
      "The current store does not support the get/getKey method."
    );
  };

  //  Attach new prop resetKey permanently to ensure this points to correct store
  //  so user only needs the rate limiter and not store object as well
  (middleware as RateLimitRequestHandler).resetKey = config.store.resetKey.bind(
    config.store
  );
  (middleware as RateLimitRequestHandler).getKey =
    typeof config.store.get === "function"
      ? config.store.get.bind(config.store)
      : getThrowFn;

  return middleware as RateLimitRequestHandler;
};

// Type checks and adds defaults for missing option fields
const parseOptions = (passedOptions: Partial<Options>): Configuration => {
  const definedOptions: Partial<Options> =
    omitUndefinedProperties<Partial<Options>>(passedOptions);

  const logger = passedOptions.logger ?? ConsoleLogger;

  const config: Configuration = {
    windowMs: 60 * 1000, // 1 min
    limit: passedOptions.limit ?? 5,
    message: "Too many request, please try again later.",
    statusCode: 429,
    requestPropertyName: "rateLimit",
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
    reqSuccessful: (req: Request, res: Response): boolean =>
      res.statusCode < 400,
    skip: (req: Request, res: Response): boolean => false,
    async keyGen(req: Request, res: Response): Promise<string> {
      const ip: string = req.ip!;

      //  Default to 56 mask if unprovided
      let subnet: number | false = 56;

      if (isIPv6(ip))
        //  Apply subnet
        subnet =
          typeof config.ipv6Subnet === "function"
            ? await config.ipv6Subnet(req, res)
            : config.ipv6Subnet;

      return ipKeyGen(ip, subnet);
    },
    ipv6Subnet: 56,

    //  Handles when user is rate limited
    async handler(
      req: Request,
      res: Response,
      next: NextFunction,
      optionsUsed: Options
    ): Promise<void> {
      res.status(config.statusCode);
      //  If message is a method then call it, otherwise save the message
      const message: unknown =
        typeof config.message === "function"
          ? await (config.message as ValueDeterminingMiddleware<any>)(req, res)
          : config.message;

      //  Prevents Node.js server from crashing if response already sent to client
      if (!res.writableEnded) res.send(message);
    },
    passOnStoreError: false,
    ...definedOptions, // Allow fields above to be overwritten by already defined options
    store: definedOptions.store ?? new MemoryStore(), // If store does not exist, create a new one
    logger,
  };

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
      "Invalid store was passed. Ensure the store is a class which implements the `Store` interface."
    );

  return config;
};

const getOptionsFromConfig = (config: Configuration): Options => {
  return config as Options;
};

// Removes properties where their value is set to undefined
const omitUndefinedProperties = <T extends { [key: string]: any }>(
  passedOptions: T
): T => {
  const omitted = {} as T;

  for (const k of Object.keys(passedOptions)) {
    const key = k as keyof T;

    if (passedOptions[key] !== undefined) omitted[key] = passedOptions[key];
  }

  return omitted;
};


export default rateLimit;