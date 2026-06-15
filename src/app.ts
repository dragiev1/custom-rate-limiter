/**
 *  Bare bones prototype
 */

import express from 'express';
import type { Request, Response, NextFunction } from 'express';

const app = express();
const PORT = 3000;

// Prototype map to hold store hit counts
// Note: Key = IP addy, Value = number of hits
const hitCounts = new Map<string, number>();
const LIMIT = 5;
const WINDOW_MS = 60000; // 1 min

// Custom middleware
const simpleRateLimiter = (req: Request, res: Response, next: NextFunction) => {
  // Identify user
  const clientIP = req.ip || 'unknown';

  // Get current hit count (default to 0 if they are new)
  const currentHits = hitCounts.get(clientIP) || 0;

  // Check if they exceeded limit
  if(currentHits >= LIMIT) {
    return res.status(429).json({
      error: 'Too Many Requests',
      message: `You have exceeded the limit of ${LIMIT} requests. Current hits: ${currentHits}.`
    });
  }

  // Increment hit count and save back into map
  hitCounts.set(clientIP, currentHits + 1);

  // Allow the request to proceed to the actual route
  next();
};


// Add middleware to all routes
app.use(simpleRateLimiter);

// Dummy apis to test rate limiter method
app.get('/', (req: Request, res: Response) => {
  res.json({message: 'Success. Not limited.'});
});

app.listen(PORT, () => {
  console.log(`Server is running on http:localhost:${PORT}`);
});