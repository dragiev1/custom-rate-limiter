import { Response, Request, NextFunction } from 'express'
import { RateLimitInfo } from './types'

export const SUPPORTED_DRAFT_VERSIONS = [
  'draft-6',
  'draft-7',
  'draft-8',
]

const getSeconds = (windowMs: number, resetTime?: Date): number => {
  let seconds: number
  if (resetTime) {
    const deltaSeconds = Math.ceil((resetTime.getTime() - Date.now()) / 1000)
    seconds = Math.max(0, deltaSeconds)
  } else seconds = Math.ceil(windowMs / 1000)

  return seconds
}

// TODO: Create methods for setting legacy and SUPPORTED_DRAFT_VERSIONS headers


// Bare bones boilerplate method for setting headers conventionally
export const setHeaders = (res: Response, info: RateLimitInfo) => {
  res.set('RateLimit-Limit', String(info.limit));
  res.set('RateLimit-Remaining', String(info.remaining));
  res.set('RateLimit-Reset', String(info.resetTime?.getMinutes));
}
