import { Router, Request, Response } from 'express'
import { RoutingService } from '../services/routing.service'
import { SessionService } from '../services/session.service'
import { sendMessage } from '../services/sender.service'
import { dispatch } from '../handlers'
import { getRedisClient } from '../lib/redis'
import type { InboundMessage } from '../types'

const router = Router()
const routing = new RoutingService()
const sessions = new SessionService()

/**
 * GET /webhook/meta
 * Meta webhook verification challenge — sent when you register the URL in the portal.
 */
router.get('/', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'] as string
  const token = req.query['hub.verify_token'] as string
  const challenge = req.query['hub.challenge'] as string

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    console.log('[Meta] Webhook verified successfully')
    res.status(200).send(challenge)
    return
  }

  console.warn('[Meta] Webhook verification failed', { mode, token })
  res.status(403).send('Forbidden')
})

/**
 * POST /webhook/meta
 * Receives inbound WhatsApp messages from Meta Cloud API.
 * Must respond 200 immediately — process async.
 */
router.post('/', (req: Request, res: Response) => {
  res.status(200).send('OK')

  ;(async () => {
    try {
      const body = req.body as MetaWebhookPayload

      if (body.object !== 'whatsapp_business_account') return

      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.field !== 'messages') continue

          const value = change.value
          const messages = value.messages || []
          const metadata = value.metadata

          for (const message of messages) {
            if (message.type !== 'text') continue

            const from = '+' + message.from
            const messageBody = message.text?.body || ''
            const messageId = message.id

            if (!from || !messageBody || !messageId) continue

            let config
            try {
              config = await routing.resolve(metadata.display_phone_number)
            } catch (err: any) {
              console.error(`[Meta] No partner config for number: ${metadata.display_phone_number} — ${err?.message}`)
              continue
            }

            const redis = getRedisClient()
            const dedupKey = `wa_msgid:${messageId}`
            const inserted = await redis.set(dedupKey, '1', 'EX', 3600, 'NX')
            if (!inserted) continue

            const session = await sessions.get(from, config.partnerId)

            const inbound: InboundMessage = {
              from,
              to: metadata.display_phone_number,
              body: messageBody,
              messageId,
              timestamp: Date.now(),
            }

            const output = await dispatch(inbound, session, config)

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

            if (output.reply) {
              await sendMessage(from, output.reply, config)
            }
          }
        }
      }
    } catch (err) {
      console.error('[Meta] Unhandled error processing webhook:', err)
    }
  })()
})

interface MetaWebhookPayload {
  object: string
  entry: MetaEntry[]
}

interface MetaEntry {
  id: string
  changes: MetaChange[]
}

interface MetaChange {
  field: string
  value: MetaChangeValue
}

interface MetaChangeValue {
  messaging_product: string
  metadata: {
    display_phone_number: string
    phone_number_id: string
  }
  messages?: MetaMessage[]
}

interface MetaMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
}

export default router
