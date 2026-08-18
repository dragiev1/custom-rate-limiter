# Custom Rate Limiter

[![Node.js Version](https://img.shields.io/badge/node-%3E%3D%2014.0.0-brightgreen)](https://nodejs.org/)
[![Express](https://img.shields.io/badge/express-%3E%3D%204.11.0-black)](https://expressjs.com/)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A lightweight and highly customizable rate-limiting middleware for Node.js and Express applications. It is designed to cap API requests, minimize resource usage, and protect applications from abuse, brute-force attacks, and sophisticated bot bypassing.

## Features

- **Window-Based Counter Algorithm**: Utilizes an efficient windowed counter approach to accurately and fairly track request frequency.
- **Advanced IPv6/IPv4 Subnet Masking**: Prevents bad actors from bypassing limits via IPv6 rotation through grouping addresses into configurable subnet blocks (default: 56-bit mask).
- **Flexible Storage**: Defaults to a memory-efficient in-memory `Map`, architectured for easy adaptation to Redis or other databases for horizontal scaling.
- **Highly Configurable**: Fine-tune limits, time windows, custom messages, HTTP status codes, and header formats.
- **Smart Skipping Logic**: Optionally skip counting failed requests, successful requests, or apply custom bypass logic for specific users/routes.
- **Express Middleware Ready**: Drop it into your existing Express pipeline easily with `app.use()`.

---

## Installation


Install directly from this GitHub repository: (Recommended for now)
```bash
npm install dragiev1/custom-rate-limiter
```

## Quick Start

Here is a basic example of how to apply the rate limiter to all requests in an Express application:

```js
const express = require('express')
const rateLimiter = require('custom-rate-limiter')

const app = express()

// Configuration
const limiter = rateLimiter({
  windowMs: 15 * 60 * 1000,       // 15 minutes
  limit: 100,                     // Limit each IP to 100 requests per window
  ipv6Subnet: 56,                 // Group IPv6 addresses by 56-bit subnet (default)
  message: 'Too many requests, please try again later.',
  standardHeaders: true,          // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,           // Disable legacy `X-RateLimit-*` headers
})

// Apply the rate limiting middleware to all requests
app.use(limiter)

app.get('/', (req, res) => {
  res.send('Hello! This endpoint is rate-limited.')
})

app.listen(3000, () => {
  console.log('Server is running on port 3000')
})
```

## Configuration Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `windowMs` | `number` | `60000` | Time window in milliseconds. |
| `limit` | `number` | `5` | Max number of requests allowed per `windowMs`. |
| `message` | `string` \| `object` | `"Too many requests"` | Response body sent when the limit is reached. |
| `statusCode` | `number` | `429` | HTTP status code returned when rate-limited. |
| `legacyHeaders` | `boolean` | `true` | Enable `X-RateLimit-Limit`, `X-RateLimit-Remaining`, etc. |
| `standardHeaders` | `boolean` | `false` | Enable standardized `RateLimit-Limit`, `RateLimit-Remaining`, etc. |
| `ipv6Subnet` | `number` | `56` | Subnet mask length for IPv6 grouping (e.g., `64`, `56`, `32`). |
| `skipFailedRequests`| `boolean` | `false` | Do not count requests that result in an error/failure. |
| `skipSuccessfulRequests`| `boolean`| `false` | Do not count requests that complete successfully. |
| `skip` | `function` | `undefined` | Custom function `(req, res) => boolean` to bypass limiting. |
| `keyGen` | `function` | `undefined` | Custom function to generate the identifier key (overrides default IP/subnet logic). |
| `handler` | `function` | `undefined` | Custom function to handle the response when a request is denied. |
| `passOnStoreError` | `boolean` | `false` | Allow requests to proceed if the storage mechanism fails. |
| `store` | `object` | `In-Memory Map` | Custom storage engine instance (must implement `increment`, `get`, etc.). |
| `validate` | `boolean` | `true` | Enable internal validation of configuration objects. |


## Advanced Options: IPv6 Subnet Masking

A common vulnerability in rate limiters is "IPv6 dynamic allocation," where a single device can rotate through thousands of IPv6 addresses in 24 hours; bypassing rate limits.

Instead of blocking individual IPv6 addresses or potentially entire ISP blocks, this rate limiter uses subnet truncation. It generalizes the IPv6 address based on a configurable bit mask:

    64 bits: Lenient.
     Looks only at the network prefix. Good for preventing basic bot rotation without affecting users on local networks.
    56 bits: Default. 
      A balanced approach that effectively stops IP-rotating bots while minimizing false positives.
    32 bits: Aggressive. 
      Generalizes a huge block of IPs. Use caution as it may rate-limit innocent users sharing the same broader ISP infrastructure.

Ex: With a 64-bit mask, requests from 

`2001:0db8:85a3:0000:1111:2222:3333:4444` and `2001:0db8:85a3:0000:aaaa:bbbb:cccc:dddd`

are treated as the same client, preventing trivial interface-identifier spoofing.

## Core Logic

A request comes in and hits the middleware, then the following happens:

+ **Skip Check**: It evaluates `skip`, `skipFailedRequests`, `skipSuccessfulRequests` to determine if the incoming request should be ignored or not.
+ **Key Generation**: Then extracts the client's IP address and applies the `ipv6Subnet` mask (or perhaps a custom `keyGen` is provided by the developer) to create a stable identifier.
+ **Incrementation/Decrementation**: Next, it fetches the current state from the `store` and increments the hit counter for that key. 
+ **Limit Check**: Compares the current hit count against the configured `limit` within the active `windowMs`. 
+ **Block or Allow**: If the total hits is under the limit set, the request proceeds to the next middleware. If exceeded, however, it triggers the `handler` and returns a `429 too many requests` response.

### Future Plans

* Native Redis store integration for seamless horizontal scaling across multiple server instances.
+ Support for distributed store adapters (MongoDB, PostreSQL).
+ Possible sliding window algorithm approach toggable setting inside configurations.

## License 
MIT License.


### Additional Notes

Detailed architectural explainations, algorithmic breakdowns, and development notes are maintained in [NOTES.md.](NOTES) :D