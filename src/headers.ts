import { Response, Request, NextFunction } from 'express'
import { RateLimitInfo } from './types'

export const setHeaders = (res: Response, info: RateLimitInfo) => {
  res.set('RateLimit-Limit', String(info.limit));
  res.set('RateLimit-Remaining', String(info.remaining));
  res.set('RateLimit-Reset', String(info.resetTime?.getMinutes));
}