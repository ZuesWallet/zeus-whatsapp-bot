import express, { Request, Response } from 'express'
import twilioRouter from './routes/twilio'
import metaRouter from './routes/meta'
import internalRouter from './routes/internal'
import { receiptCache } from './services/twilio.service'

const app = express()

// Twilio sends form-encoded — urlencoded parser only for webhook route
app.use('/webhook/twilio', express.urlencoded({ extended: false }), twilioRouter)

// Meta Cloud API webhook — GET for verification challenge, POST for inbound messages
app.use('/webhook/meta', express.json(), metaRouter)

// Internal routes use JSON
app.use('/internal', express.json(), internalRouter)

// Receipt images served publicly for Twilio media fetching
// Filenames are unguessable (transactionId + timestamp), so no auth needed
app.get('/receipt/:filename', (req: Request, res: Response) => {
  const filename = req.params.filename as string

  if (!/^receipt_[a-zA-Z0-9_-]+\.png$/.test(filename)) {
    res.status(400).send('Invalid filename')
    return
  }

  const cached = receiptCache.get(filename)
  if (!cached || cached.expiresAt < Date.now()) {
    receiptCache.delete(filename)
    res.status(404).send('Receipt not found or expired')
    return
  }

  res.setHeader('Content-Type', 'image/png')
  res.setHeader('Content-Length', cached.buffer.length)
  res.setHeader('Cache-Control', 'no-store')
  res.send(cached.buffer)
})

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'zeuspay-whatsapp' })
})

export default app
