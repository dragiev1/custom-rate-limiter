import createServer from 'express'
import rateLimit from '../../../../src/rate-limit'

import { createClient } from 'redis'
import RedisAdapter from './redis-adapter'

// Basic express app
const app = createServer()
// Redis setup
const client = createClient()
await client.connect()

// Middleware setup
app.use(rateLimit({
    limit: 3,
    message: 'Thou shall not pass',
    store: new RedisAdapter({
        sendCommand: (...args: string[]) => client.sendCommand(args),
    }),
}))

export default app