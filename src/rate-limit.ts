// Rate limit middleware

import { Request, Response, NextFunction } from "express";
import {
  AugmentedRequest,
  Logger,
  Options,
  RateLimitExceededEventHandler,
  RateLimitReachedEventHandler,
  Store,
  ValueDeterminingMiddleware,
} from "./types";
import { MemoryStore } from "./memory-store";

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


const rateLimit = (passedOptions: Options) => {
  const config = {
    windowMs: passedOptions.windowMs ?? 60 * 1000, // 1 min
    limit: passedOptions.limit ?? 5, 
    message: passedOptions.message ?? "Too Many Requests",
    statusCode: passedOptions.statusCode ?? 429,
    keyGen: passedOptions.keyGen ?? ((req) => req.ip ?? "unknown"),
    skip: passedOptions.skip ?? (() => false),
    handler: passedOptions.handler ?? ((req, res) => {res.status(config.statusCode).send(config.message)}),
    store: passedOptions.store ?? new MemoryStore().init(passedOptions)
  };

  const middleware = async (req: Request, res: Response, next: NextFunction) => {
    const skip = await config.skip(req, res);
    if (skip) return next();

    const key = await config.keyGen(req, res);

    const {totalHits} = await config.store.inc(key);
    console.log(`User ${key} has ${totalHits} hits.`);

    if(totalHits > config.limit) return config.handler(req, res, next, passedOptions);

    next();
  };

  (middleware as any).resetKey = config.store.resetKey.bind(config.store);
  return middleware;
};
