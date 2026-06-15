// Types for package
import type {NextFunction, Request, RequestHandler, Response} from 'express';

// Logging function
export type LoggerFn = (error: unknown, message?: string) => void

// Interface for logging warnings & errors
export type Logger = {
  error: LoggerFn,
  warn: LoggerFn
}

// Callback which fires when a client's hit counter is adjusted
export type IncrementCallback = (
  error: Error | undefined,
  totalHits: number,
  resetTime: Date | undefined,
) => void

