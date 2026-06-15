// Types for package
import type {NextFunction, Request, RequestHandler, Response} from 'express';

// Logging function
export type LoggerFn = (error: unknown, message?: string) => void

// Interface for logging warnings & errors
export type Logger = {
  error: LoggerFn,
  warn: LoggerFn
}

export type Options = {
  windowMs: number  // How long to remember requests
  limit: number  // Max requests before limiting client, defaults to 5
  message: any  
  statusCode: number  // HTTP status code to send back when a client is rate limited
  skipFailedRequest: boolean
  skipSuccessfulRequests: boolean
}

// Callback which fires when a client's hit counter is adjusted
export type IncrementCallback = (
  error: Error | undefined,
  totalHits: number,
  resetTime: Date | undefined,
) => void


export type RateLimitExceededEventHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
  optionsUsed: Options,
) => void;