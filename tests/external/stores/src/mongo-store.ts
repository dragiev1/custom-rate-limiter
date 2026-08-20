import createServer from "express";
import rateLimit from '../../../../src/rate-limit'
// @ts-expect-error - not type definitions
import MongoStore from 'rate-limit-mongo'

// Create express server
const app = createServer()
// Middleware setup
app.use(
    rateLimit({
        limit: 3,
        message: 'Thou shall not pass',
        // MongoDB adapter/translator
        store: new MongoStore({
            // Connection string to local machine, 27017 is the door that maps to MongoDB Docker container
            uri: 'mongodb://127.0.0.1:27017/test_db',
            // Clever trick to prefill the first argument of console.error if DB fails, we know which one failed and the error corresponding to it
            // ex: "rate-limit-mongo: [Error]"
            errorHandler: console.error.bind(null, 'rate-limit-mongo'),
        })
    })
)

// Simple endpoint for testing
app.get('/', (req, res) => {
    res.send(`Hello there ${req.body?.name}`)
})

// Export the app away!
export default app