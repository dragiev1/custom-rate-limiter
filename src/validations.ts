//  Validation functions for strict type checking
import { isIP } from "node:net";
import type { Request } from 'express'
import { SUPPORTED_DRAFT_VERSIONS } from "./headers";
import { Store } from "./types";



class ValidationError extends Error {
  name: string
  code: string
  help: string

  constructor(code: string, message: string) {
    const url = `https:custom-rate-limiter.github.io/${code}/`
    super(`${message} See ${url} for more info.`)
    this.name = this.constructor.name
    this.code = code
    this.help = url
  }

}

//  Store instances that have been used with whichever rateLimit instance
//  (same store cannot be used in various different instances)
const usedStores = new Set<Store>()

/**
 * Maps the key used in a store for a certain request and ensures the same key is 
 * not used more than once per request.
 * The store can either be an instance (like MemoryStore where two instances do not share state)
 * or a string for stores where multiple instances typically share states (like a Redis store).
 * Check documentation for more information. 
 */
const singleCountKeys = new WeakMap<Request, Map<Store | string, string[]>>()


// Dictonary of checks.

const validations = {
  enabled: {
    default: true,
  } as { [key: string]: boolean },
 
  // Method for disabling validations
  disable() {
    for (const k of Object.keys(this.enabled)) this.enabled[k] = false
  },

  // Network related validation checks.
  
  ip(ip: string | undefined) {
    if (ip === undefined) throw new ValidationError(
      'custom-rate-limiter: UNDEFINED_IP_ADDRESS',
      `An undefined 'request.ip' was detected. This might indicate misconfigurations or the connection was prematurely severed.`
    )

    if (!isIP(ip)) throw new ValidationError(
      'custom-rate-limiter: INVALID_IP_ADDRESS',
      `An invalid 'request.ip' was detected (${ip}).`
    )
  },

  
}