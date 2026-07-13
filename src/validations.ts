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
 
  // Method for disabling validations, not very recommended
  disable() {
    for (const k of Object.keys(this.enabled)) this.enabled[k] = false
  },

  // Network related validation checks
  
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

  // Proxy validation to make sure it is not set to true
  trustProxy(req: Request) {
    if (req.app.get('trust proxy') === true)
      throw new ValidationError(
        'custom-rate-limiter: PERMISSIVE_TRUST_PROXY',
        `The Express 'trust proxy' setting is true, allowing anyone to bypass the rate limiter easily.`
      )
  },


  /* Checks for mismatches. */ 

  // Proxy validation for 'X-Forwarded-For' header case
  xForwardedForHeader(req: Request) {
    if (req.headers['x-forwarded-for'] && req.app.get('trust proxy') === false)
      throw new ValidationError(
        'custom-rate-limiter: UNEXPECTED_X_FORWARDED_FOR',
        `The 'X-Forwarded-For' header is set but Express 'trust proxy' setting is false by default. This is potentially caused by a misconfiguration in settings and can prevent the rate limiter from accurately identifying users.`
      )
  },


  // Alert user if Forwarded header is set (standardized version of X-Forwarded-For)
  forwardedHeader(req: Request) {
    if ( req.headers.forwarded && req.ip === req.socket?.remoteAddress) 
      throw new ValidationError(
        'custom-rate-limiter: FORWARDED_HEADER',
        `The 'Forwarded' header (standardized X-Forwarded-For) is set but currently being ignored. Add a custom keyGen to use a value from this header.`
      )
  },


  /* Store and counting validations */
  

}