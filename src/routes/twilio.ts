import { Router, Request, Response } from 'express'
import { RoutingService } from '../services/routing.service'
import { SessionService } from '../services/session.service'
import { TwilioService } from '../services/twilio.service'
import { dispatch } from '../handlers'
import { getRedisClient } from '../lib/redis'
import type { InboundMessage } from '../types'

const router = Router()
const routing = new RoutingService()
const sessions = new SessionService()
const twilioSvc = new TwilioService()

// POST /webhook/twilio
// Twilio sends form-encoded body — express.urlencoded() must be applied upstream
router.post('/', async (req: Request, res: Response) => {
  // Respond immediately — Twilio requires a fast 200
  res.status(200).send('<Response></Response>')

  // Everything below is fire-and-forget
  ;(async () => {
    try {
      const from: string = (req.body.From as string)?.replace('whatsapp:', '') || ''
      const to: string = (req.body.To as string)?.replace('whatsapp:', '') || ''
      const body: string = (req.body.Body as string) || ''
      const messageId: string = (req.body.MessageSid as string) || ''

      if (!from || !to || !body || !messageId) return

      // 1. Resolve partner config from the receiving number
      let config
      try {
        config = await routing.resolve(to)
      } catch (err) {
        console.error(`[WhatsApp] No partner config for number ${to}:`, err)
        return
      }

      // 2. Verify Twilio signature
      const signature = req.headers['x-twilio-signature'] as string
      const publicUrl = process.env.PUBLIC_URL || ''
      const webhookUrl = `${publicUrl}/webhook/twilio`

      const isValid = twilioSvc.verifySignature({
        url: webhookUrl,
        signature: signature || '',
        body: req.body as Record<string, string>,
        authToken: config.twilioCredentials.authToken,
      })

      if (!isValid && process.env.NODE_ENV === 'production') {
        console.warn(`[WhatsApp] Invalid Twilio signature from ${from}`)
        return
      }

      // 3. Deduplicate — skip if messageId already processed
      const redis = getRedisClient()
      const dedupKey = `wa_msgid:${messageId}`
      const inserted = await redis.set(dedupKey, '1', 'EX', 3600, 'NX')
      if (!inserted) {
        console.log(`[WhatsApp] Duplicate message skipped: ${messageId}`)
        return
      }

      // 4. Load session
      const session = await sessions.get(from, config.partnerId)

      // 5. Build inbound message
      const inbound: InboundMessage = {
        from,
        to,
        body,
        messageId,
        timestamp: Date.now(),
      }

      // 6. Dispatch
      const output = await dispatch(inbound, session, config)

      // 7. Update session
      if (output.newSession !== undefined) {
        if (
          output.newSession === null ||
          (!output.newSession.flow && !output.newSession.step)
        ) {
          await sessions.clear(from, config.partnerId)
        } else {
          await sessions.set(from, config.partnerId, output.newSession)
        }
      } else {
        await sessions.extendTTL(from, config.partnerId)
      }

      // 8. Send reply
      if (output.reply) {
        await twilioSvc.send({
          to: from,
          from: to,
          body: output.reply,
          credentials: config.twilioCredentials,
        })
      }
    } catch (err) {
      console.error('[WhatsApp] Unhandled error processing message:', err)
    }
  })()
})

export default router
