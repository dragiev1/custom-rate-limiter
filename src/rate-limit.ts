// Rate limit middleware

import { NextFunction } from "express";
import {
  AugmentedRequest,
  Logger,
  Options,
  RateLimitExceededEventHandler,
  RateLimitReachedEventHandler,
  Store,
  ValueDeterminingMiddleware,
} from "./types";

//  Dupe of Options, but strictly for rate-limit.ts and has no access by the user
type Configuration = {
  windowMs: number;
  limit: number | ValueDeterminingMiddleware<number>;
  message: any | ValueDeterminingMiddleware<any>;
  statusCode: number;
  identifier: string | ValueDeterminingMiddleware<string>;
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

// TODO: Replace Options with Partial<Options> for cases when some options aren't necessary or given
const rateLimit = (options: Options): RateLimitReachedEventHandler => {
  // Parse options and add default values for unspecified options
  // TODO: make a proper config object that is extracted from specific user's choices or defaults

  // Simple version of middleware, not working!
  const middleware = async (
    req: Request,
    res: Response,
    next: NextFunction
  ) => {
    // Check if we should skip the request
    if (await options.skip) return next();

    const key = await options.keyGen(req, res)

    const {totalHits} = await options.store.inc(key)
    console.log(`User ${key} has ${totalHits} hits.`)

    if(totalHits > options.limit) return options.handler(req, res, next, options)  // BLOCK!

    //  Otherwise, allow through
    next()
  };
};
