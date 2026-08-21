import createServer from 'express'
import rateLimit from '../../../../src/rate-limit'

import { RedisStore } from 'rate-limit-redis'
import { createClient } from 'redis'

// Basic express app
const app = createServer()
// Redis setup
const client = createClient()
await client.connect()

// Middleware setup
app.use(rateLimit({
    limit: 3,
    message: 'Thou shall not pass',
    store: new RedisStore({
        sendCommand: (...args) => client.sendCommand(args),
    }),
}))