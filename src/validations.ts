//  Validation functions for strict type checking
import { isIP } from "node:net";
import type { Request } from "express";
import { SUPPORTED_DRAFT_VERSIONS } from "./headers";
import { EnabledValidations, Logger, Options, Store, ValueDeterminingMiddleware } from "./types";
import { enableCompileCache } from "node:module";

class ValidationError extends Error {
  name: string;
  code: string;
  help: string;

  constructor(code: string, message: string) {
    const url = `https:custom-rate-limiter.github.io/${code}/`;
    super(`${message} See ${url} for more info.`);
    this.name = this.constructor.name;
    this.code = code;
    this.help = url;
  }
}

//  Store instances that have been used with whichever rateLimit instance
//  (same store cannot be used in various different instances)
const usedStores = new Set<Store>();

/**
 * Maps the key used in a store for a certain request and ensures the same key is
 * not used more than once per request.
 * The store can either be an instance (like MemoryStore where two instances do not share state)
 * or a string for stores where multiple instances typically share states (like a Redis store).
 * Check documentation for more information.
 */
const singleCountKeys = new WeakMap<Request, Map<Store | string, string[]>>();

// Dictonary of checks.

const validations = {
  enabled: {
    default: true,
  } as { [key: string]: boolean },

  // Method for disabling validations, not very recommended
  disable() {
    for (const k of Object.keys(this.enabled)) this.enabled[k] = false;
  },

  // Network related validation checks

  ip(ip: string | undefined) {
    if (ip === undefined)
      throw new ValidationError(
        "custom-rate-limiter: UNDEFINED_IP_ADDRESS",
        `An undefined 'request.ip' was detected. This might indicate misconfigurations or the connection was prematurely severed.`,
      );

    if (!isIP(ip))
      throw new ValidationError(
        "custom-rate-limiter: INVALID_IP_ADDRESS",
        `An invalid 'request.ip' was detected (${ip}).`,
      );
  },

  // Proxy validation to make sure it is not set to true
  trustProxy(req: Request) {
    if (req.app.get("trust proxy") === true)
      throw new ValidationError(
        "custom-rate-limiter: PERMISSIVE_TRUST_PROXY",
        `The Express 'trust proxy' setting is true, allowing anyone to bypass the rate limiter easily.`,
      );
  },

  /* Checks for mismatches. */

  // Proxy validation for 'X-Forwarded-For' header case
  xForwardedForHeader(req: Request) {
    if (req.headers["x-forwarded-for"] && req.app.get("trust proxy") === false)
      throw new ValidationError(
        "custom-rate-limiter: UNEXPECTED_X_FORWARDED_FOR",
        `The 'X-Forwarded-For' header is set but Express 'trust proxy' setting is false by default. This is potentially caused by a misconfiguration in settings and can prevent the rate limiter from accurately identifying users.`,
      );
  },

  // Alert user if Forwarded header is set (standardized version of X-Forwarded-For)
  forwardedHeader(req: Request) {
    if (req.headers.forwarded && req.ip === req.socket?.remoteAddress)
      throw new ValidationError(
        "custom-rate-limiter: FORWARDED_HEADER",
        `The 'Forwarded' header (standardized X-Forwarded-For) is set but currently being ignored. Add a custom keyGen to use a value from this header.`,
      );
  },

  /* Store and counting validations. */

  positiveHits(hits: any) {
    if (!Number.isInteger(hits) || hits < 1)
      throw new ValidationError(
        "custom-rate-limiter: INVALID_HITS",
        `The totalHits value from store must be a positive integer, returned ${hits}.`,
      );
  },

  // Ensures a single store instance is not used with multiple rate limit instances and prevents state bleeding
  unsharedStore(store: Store) {
    if (usedStores.has(store)) {
      const maybeUniquePrefix = store?.localKeys ? "" : " (with unique prefix)";
      throw new ValidationError(
        "custom-rate-limiter: STORE_REUSE",
        `A Store instance should not be shared across multiple rate limiters. Create a new instance of ${store.constructor.name}${maybeUniquePrefix}.`,
      );
    }
    usedStores.add(store);
  },

  // Protects users from being penalized more than one times for a unique HTTP request
  singleCount(req: Request, store: Store, key: string) {
    let storeKeys = singleCountKeys.get(req);

    if (!storeKeys) {
      storeKeys = new Map();
      singleCountKeys.set(req, storeKeys);
    }

    const storeKey = store.localKeys ? store : store.constructor.name;
    let keys = storeKeys.get(storeKey);
    if (!keys) {
      keys = [];
      storeKeys.set(storeKey, keys);
    }

    const prefixedKey = `${store.prefix ?? ""}${key}`;
    if (keys.includes(prefixedKey)) {
      throw new ValidationError(
        "custom-rate-limiter: DOUBLE_COUNT",
        `Hit count for ${key} was incremented more than once for a single request.`,
      );
    }

    keys.push(prefixedKey);
  },

  /* Configuration and deprecation warnings */

  // Ensures the IETF draft version in config is supported
  headersDraftVersion(version?: any) {
    if (
      typeof version !== "string" ||
      !SUPPORTED_DRAFT_VERSIONS.includes(version)
    )
      throw new ValidationError(
        "custom-rate-limiter: HEADERS_UNSUPPORTED_DRAFT_VERSION",
        `standardHears: only supported version of the IETF draft specification are as followed: ${SUPPORTED_DRAFT_VERSIONS.join(
          ", ",
        )}.`,
      );
  },

  // Warns that the draft-7 required resetTime was not given and will default to using windowMs
  headersResetTime(resetTime?: Date) {
    if (!resetTime)
      throw new ValidationError(
        "custom-rate-limiter: NO_RESET_TIME_HEADERS",
        `standardHeaders: 'draft-7' requires a 'resetTime' header, but store was not provided one. 'windowMs' will be used instead, which may cause clients to wait longer than needed.`,
      );
  },

  // Checks for passed in options in configuration whether they are valid
  knownOptions(passedOptions?: Partial<Options>) {
    if (!passedOptions) return;

    type KeysEnum<T> = { [P in keyof Required<T>]: true };

    const optionsMap: KeysEnum<Options> = {
      windowMs: true,
      limit: true,
      message: true,
      statusCode: true,
      legacyHeaders: true,
      standardHeaders: true,
      identifier: true,
      requestPropertyName: true,
      skipFailedRequests: true,
      skipSuccessfulRequests: true,
      keyGen: true,
      ipv6Subnet: true,
      handler: true,
      skip: true,
      reqSuccessful: true,
      store: true,
      validate: true,
      passOnStoreError: true,
      logger: true,
    };

    const validOptions = Object.keys(optionsMap).concat(
      "draft_polli_ratelimit_headers",
      "delayAfter",
      "delayMs",
      "maxDelayMs",
    );

    for (const key of Object.keys(passedOptions))
      if (!validOptions.includes(key))
        throw new ValidationError(
          "custom-rate-limiter: UNKNOWN_OPTION_IN_CONFIG",
          `Unexpected configuration options: ${key}.`,
        );
  },

  validationsConfig() {
    const supportedValidations = Object.keys(this).filter(
      (k) => !["enabled", "disable"].includes(k),
    );
    supportedValidations.push("default");
    for (const key of Object.keys(this.enabled))
      if (!supportedValidations.includes(key))
        throw new ValidationError(
          "custom-rate-limiter: UNKNOWN_VALIDATION",
          `Unexpected option value '${key}' is not recognized. Supported validate options are: {${supportedValidations.join(", ")}}.`,
        );
  },

  /* Edge Cases + Lifecycle */

  // Checks if the instance was created inside of a request handler
  creationStack(store: Store) {
    const { stack } = new Error(
      "custom-rate-limiter validation check !=~=set options.validate.creationStack=false to disable=~=!",
    );

    if (
      stack?.includes("Layer.handle [as handle_request") ||
      stack?.includes("Layer.handleRequest")
    ) {
      if (!store.localKeys)
        throw new ValidationError(
          "custom-rate-limiter: CREATED_IN_REQUEST_HANDLER",
          `custom-rate-limiter instance should be created at app initialization, not when responding to a request.`,
        );

      throw new ValidationError(
        "custom-rate-limiter: CREATED_IN_REQUEST_HANDLER",
        `custom-rate-limiter instance should be created at app initialization.`,
      );
    }
  },


  ipv6Subnet(ipv6Subnet?: any) {
    // Subnet is explicitly disabled
    if(ipv6Subnet === false) return

    if( !Number.isInteger(ipv6Subnet) || ipv6Subnet < 32 || ipv6Subnet > 64 ) 
      throw new ValidationError(
        'custom-rate-limiter: IPV6_SUBNET',
        `Unknown ipv6 subnet value: ${ipv6Subnet}. Expected an integer between 32 and 64.`
      )
  },


  keyGeneratorIpFallback(keyGen?: ValueDeterminingMiddleware<string>) {
    if(!keyGen) return

    const src = keyGen.toString()
    if ( (src.includes('req.ip') || src.includes('request.ip')) && !(src.includes('ipKeyGen') || src.includes('ipKeyGenerator'))) 
      throw new ValidationError(
        'custom-rate-limiter: KEY_GEN_IPV6',
        `Custom key generator seems to use request IP without calling the ipKeyGenerator helper function for IPv6 addresses. This could potentially allow exceeding rate limits.`
      )
  },

  // If window duration is greater than 2^31 - 1 or less than 1, plus type checking
  windowMs(windowMs: number) {
    const SET_TIMEOUT_MAX = 2 ** 31 - 1
    if ( typeof windowMs !== 'number' || Number.isNaN(windowMs) || windowMs < 1 || windowMs > SET_TIMEOUT_MAX )
      throw new ValidationError(
        'custom-rate-limiter: WINDOW_MS',
        `Invalid windowMs value: ${windowMs}${typeof windowMs !== 'number' ? ` (${typeof windowMs})`: ''}`
      ) 
  },
};


function validateLogger(logger: Logger): void {
  if ( typeof logger !== 'object' || typeof logger.error !== 'function' || typeof logger.error !== 'function' )
    throw new TypeError('Provided logger does not implement the Logger interface.')
};


export type Validations = typeof validations


// Creates copy of the validations object where each method is wrapped to catch and log any thrown errors.
export const getValidations = (
  _enabled: boolean | EnabledValidations,   // Raw input from user
  logger: Logger,
): Validations => {
  validateLogger(logger)  // Check logger

  // Figure out what is enabled
  let enabled: { [key: string]: boolean }  // Cleaned and normalized internal variable
  if (typeof _enabled === 'boolean') 
    enabled = { default: _enabled }
  else enabled = { default: true, ..._enabled }

  // Create wrapper object
  const wrappedValidations = { enabled } as Validations

  // Wrap all validations to handle disabling and thrown errors
  for ( const [name, validation] of Object.entries(validations)) {
    if (typeof validation === 'function') {
      // Type assert and replaces name with names of properties provided
      (wrappedValidations as { [index: string]: any })[name] = ( ...args: any[] ) => {
        if (!(enabled[name] ?? enabled.default)) return

        enabled[name] = false

        try {
          ;(validation as (...args: any[]) => void).apply(
            wrappedValidations,
            args,
          )
        } catch (err: any) {
          logger.error(err)
        }
      }
    }
  }

  return wrappedValidations
}
