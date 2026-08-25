import createServer from "express"
import rateLimit from "../../../../src/rate-limit"
import { createClient } from "redis"
import RedisAdapter from "./redis-adapter"

// Basic express app
const app = createServer()
// Redis setup
const client = createClient()
const turnOn = async () => await client.connect()
turnOn()

const redisStore = new RedisAdapter({
  sendCommand: (...args: string[]) => client.sendCommand(args),
})

// Middleware setup
app.use(
  rateLimit({
    limit: 3,
    message: "Thou shall not pass",
    store: redisStore,
  }),
)

export default app
