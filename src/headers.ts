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

export const setLegacyHeaders = (
  res: Response,
  info: RateLimitInfo,
): void => {
  if (res.headersSent) return
  
  res.setHeader('X-RateLimit-Limit', info.limit.toString())
  res.setHeader('X-RateLimit-Remaining', info.remaining.toString())
  
  // Type check reset is a Date object
  if(info.resetTime instanceof Date) {
    res.setHeader('Date', new Date().toUTCString())
    res.setHeader('X-RateLimit-Reset', Math.ceil(info.resetTime.getTime() / 1000).toString())
  }
}

// TODO: Create methods for SUPPORTED_DRAFT_VERSIONS headers

// Bare bones boilerplate method for setting headers conventionally
export const setHeaders = (res: Response, info: RateLimitInfo) => {
  res.set('RateLimit-Limit', String(info.limit));
  res.set('RateLimit-Remaining', String(info.remaining));
  res.set('RateLimit-Reset', String(info.resetTime?.getMinutes));
}
