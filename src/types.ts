// Types for package
import type { NextFunction, Request, RequestHandler, Response } from 'express';

// Logging function
export type LoggerFn = (error: unknown, message?: string) => void;

// Interface for logging warnings & errors
export type Logger = {
  error: LoggerFn,
  warn: LoggerFn
};

// Generate or retrieve a value based on the incoming request
export type ValueDeterminingMiddleware<T> = (
  req: Request,
  res: Response,
) => T | Promise<T>;

// Preferences for rate limiter
export type Options = {
  windowMs: number  // How long to remember requests
  limit: number  // Max requests before limiting client, defaults to 5
  message: any  
  statusCode: number  // HTTP status code to send back when a client is rate limited
  skipFailedRequest: boolean
  skipSuccessfulRequests: boolean
};

// Callback which fires when a client's hit counter is adjusted
export type IncrementCallback = (
  error: Error | undefined,
  totalHits: number,
  resetTime: Date | undefined,
) => void;  


export type RateLimitExceededEventHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
  optionsUsed: Options,
) => void;  

// Event callback triggered on client's first request that exceeds the limit
export type RateLimitReachedEventHandler = (
  req: Request,
  res: Response,
  optionsUsed: Options,
) => void;


// Data returned when client's hit counter is updated
export type ClientRateLimitInfo = {
  totalHits: number
  resetTime: Date | undefined
};

export type IncrementResponse = ClientRateLimitInfo

export type RateLimitRequestHandler = RequestHandler & {
  resetKey: (key: string) => void
  getKey: (key: string) => | Promise<ClientRateLimitInfo | undefined> | ClientRateLimitInfo | undefined
}

