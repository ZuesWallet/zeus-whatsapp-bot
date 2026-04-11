import 'dotenv/config'
import app from './app'
import { createRedisClient } from './lib/redis'

const PORT = process.env.PORT || 3001

async function start(): Promise<void> {
  await createRedisClient()
  app.listen(PORT, () => {
    console.log(`ZeusPay WhatsApp Bot running on port ${PORT}`)
    console.log(`  Webhook:  POST /webhook/twilio`)
    console.log(`  Internal: POST /internal/notify`)
    console.log(`  Health:   GET  /health`)
  })
}

start().catch((err) => {
  console.error('Failed to start:', err)
  process.exit(1)
})
