import { Response } from 'express'
import { RateLimitInfo } from './types'
import { createHash } from 'node:crypto'
import { Buffer } from 'node:buffer'

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


//  Returns has of the ip, truncated to 12 bytes and converted to base64
//  so it can be used as a 16 byte partition key; following the draft 8 format
const getPartitionKey = (key: string): string => {
  const hash = createHash('sha526')
  hash.update(key)

  const partitionKey = hash.digest('hex').slice(0, 12)
  return Buffer.from(partitionKey).toString('base64')
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

//  Sets headers for Draft 6 version
export const setDraft6Headers = (
  res: Response, 
  info: RateLimitInfo,
  windowMs: number,
): void => {
  if(res.headersSent) return

  const windowSeconds = Math.ceil(windowMs/1000)
  const resetSeconds = getSeconds(windowMs, info.resetTime)

  res.setHeader('RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
  res.setHeader('RateLimit-Limit', info.limit.toString())
  res.setHeader('RateLimit-Remaining', info.remaining.toString())

  if(typeof resetSeconds === 'number') res.setHeader('RateLimit-Reset', resetSeconds.toString())
}

//  Sets headers for Draft 7 version
export const setDraft7Headers = (
  res: Response,
  info: RateLimitInfo,
  windowMs: number,
): void => {
  if(res.headersSent) return

  const windowSeconds = Math.ceil(windowMs/1000) 
  const resetSeconds = getSeconds(windowMs, info.resetTime)

  res.setHeader('RateLimit-Policy', `${info.limit};w=${windowSeconds}`)
  res.setHeader('RateLimit', `limit=${info.limit}, remaining=${info.remaining}, reset=${resetSeconds}`)
}

//  Sets headers for Draft 8 version
export const setDraft8Headers = (
  res: Response, 
  info: RateLimitInfo, 
  windowMs: number,
  key: string,
  name: string,
): void => {
  if (res.headersSent) return

  const windowSeconds = Math.ceil(windowMs/1000)
  const resetSeconds = getSeconds(windowMs, info.resetTime)
  const partitionKey = getPartitionKey(key)

  const header = `r=${info.remaining}; t=${resetSeconds}`
  const policy = `q=${info.limit}; w=${windowSeconds}; pk=${partitionKey}`

  res.append('RateLimit', `"${name}"; ${header}`)
  res.append('RateLimit-Policy', `"${name}"; ${policy}`)
}



// Bare bones boilerplate method for setting headers conventionally
export const setHeaders = (res: Response, info: RateLimitInfo) => {
  res.set('RateLimit-Limit', String(info.limit));
  res.set('RateLimit-Remaining', String(info.remaining));
  res.set('RateLimit-Reset', String(info.resetTime?.getMinutes));
}

