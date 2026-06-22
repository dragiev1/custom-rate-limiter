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
import { ConsoleLogger } from "./console-logger";
import { MemoryStore } from "./memory-store";
import { ipKeyGen } from "./ip-key-gen";
import { isIPv6 } from "node:net";

//  Dupe of Options, but strictly for rate-limit.ts and has no access by the user
type Configuration = {
  windowMs: number;
  limit: number | ValueDeterminingMiddleware<number>;  // Value can be static or from custom method made by developer
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

  //  Attach new prop resetKey permanently to ensure this points to correct store 
  //  so user only needs the rate limiter and not store object as well
  (middleware as any).resetKey = config.store.resetKey.bind(config.store);

  return middleware;
};


// Type checks and adds defaults for missing option fields
const parseOptions = (passedOptions: Partial<Options>): Configuration => {
  const definedOptions: Partial<Options> = omitUndefinedProperties<Partial<Options>>(passedOptions)

  const logger = passedOptions.logger ?? ConsoleLogger

  const config: Configuration = {
    windowMs: 60 * 1000,  // 1 min
    limit: passedOptions.limit ?? 5,
    message: 'Too many request, please try again later.',
    statusCode: 429,
    requestPropertyName: 'rateLimit',
    skipFailedRequests: false,
    skipSuccessfulRequests: false,
    reqSuccessful: (req: Request, res: Response): boolean => res.statusCode < 400,
    skip: (req: Request, res: Response): boolean => false,
    async keyGen(req: Request, res: Response): Promise<string> {
      const ip: string = req.ip!

      //  Default to 56 mask if unprovided
      let subnet: number | false = 56

      if(isIPv6(ip)) 
        //  Apply subnet
        subnet = typeof config.ipv6Subnet === 'function' ? await config.ipv6Subnet(req, res) : config.ipv6Subnet
   
      return ipKeyGen(ip, subnet)
    },
    ipv6Subnet: 56,
    
    //  Handles when user is rate limited
    async handler(req: Request, res: Response, next: NextFunction, optionsUsed: Options): Promise<void> {
      res.status(config.statusCode)
      //  If message is a method then call it, otherwise save the message 
      const message: unknown = typeof config.message === 'function' ? await (config.message as ValueDeterminingMiddleware<any>)(req, res) : config.message

      //  Prevents Node.js server from crashing if response already sent to client
      if(!res.writableEnded) res.send(message)
    },
    passOnStoreError: false,
    ...definedOptions,  // Allow fields above to be overwritten by already defined options
    store: definedOptions.store ?? new MemoryStore(),  // If store does not exist, create a new one
    logger,
  }

  //  Check that the store correctly implemented the Store interface
  if(
    typeof config.store.inc !== 'function' ||
    typeof config.store.dec !== 'function' || 
    typeof config.store.resetKey !== 'function' ||
    (typeof config.store.resetAll !== 'function' && config.store.resetAll !== 'undefined') ||
    (typeof config.store.init !== 'function' && config.store.init !== 'undefined')
  ) throw new TypeError('Invalid store was passed. Ensure the store is a class which implements the `Store` interface.');

  return config;
}

// Removes properties where their value is set to undefined
const omitUndefinedProperties = <T extends { [key: string]: any }> (passedOptions: T): T => {
  const omitted = {} as T

  for (const k of Object.keys(passedOptions)) {
    const key = k as keyof T

    if(passedOptions[key] !== undefined) omitted[key] = passedOptions[key]
  }

  return omitted
} 