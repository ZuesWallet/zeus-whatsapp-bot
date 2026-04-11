import express from 'express'
import twilioRouter from './routes/twilio'
import internalRouter from './routes/internal'

const app = express()

// Twilio sends form-encoded — urlencoded parser only for webhook route
app.use('/webhook/twilio', express.urlencoded({ extended: false }), twilioRouter)

// Internal routes use JSON
app.use('/internal', express.json(), internalRouter)

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'zeuspay-whatsapp' })
})

export default app
