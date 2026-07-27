import createApp, {type Application, type Request, type RequestHandler, type Response } from "express";

/**
 * An Express server given middleware
 */
export const createServer = (
  middleware: RequestHandler | RequestHandler[],
): Application => {
  const app = createApp()

  app.use(middleware)

  app.all('/', (_req: Request, res: Response) => {
    res.send('Hello!')
  })

  app.get('/error', (_req: Request, res: Response) => {
    res.sendStatus(400)
  })

  app.post('/crash', (_req: Request, res: Response) => {
    const err = new Error('Uh oh...')
    res.destroy(err)
    res.emit('error', err)
  })

  // Return instance
  return app
}