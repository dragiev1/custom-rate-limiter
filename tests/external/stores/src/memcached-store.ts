import rateLimit from "../../../../src/rate-limit"
import createServer from 'express'

import MemcachedAdapter from "./memcached-adapter"

// Basic express app
const app = createServer()
// Whip up middleware and use the rate limiter
app.use(
    rateLimit({
        limit: 3,
        message: 'Thou shall not pass',
        // Memcached adapter setup
        store: new MemcachedAdapter({
            uri: '127.0.0.1:11211',
            errorHandler: console.error.bind(null, 'rate-limit-memcached'),
        }),
    })
)

// Simple endpoint for testing
app.get('/', (req, res) => {
    res.send(`Hello there ${req.body?.name}!`)
})

// Export away!
export default app