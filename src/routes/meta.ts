import crypto from 'crypto'
import { Router, Request, Response } from 'express'
import { RoutingService } from '../services/routing.service'
import { SessionService } from '../services/session.service'
import { ZeusPayService } from '../services/zeuspay.service'
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

/**
 * POST /webhook/meta/flow
 * WhatsApp Flow endpoint — called by Meta when a user submits the data_exchange action.
 * All payloads are AES-128-GCM encrypted (key wrapped with RSA-OAEP-SHA256).
 * Requires FLOW_PRIVATE_KEY env var (PEM RSA private key matching the public key
 * registered in the Flow settings on Meta's developer portal).
 */
router.post('/flow', async (req: Request, res: Response) => {
  const privateKeyPem = process.env.FLOW_PRIVATE_KEY
  if (!privateKeyPem) {
    console.error('[Flow] FLOW_PRIVATE_KEY not configured')
    res.status(500).send('Flow endpoint not configured')
    return
  }

  const { encrypted_aes_key, encrypted_flow_data, initial_vector } = req.body

  // --- Decrypt request ---
  let flowPayload: any
  let aesKey: Buffer
  let iv: Buffer
  try {
    aesKey = crypto.privateDecrypt(
      { key: privateKeyPem, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' },
      Buffer.from(encrypted_aes_key, 'base64')
    )
    const encryptedData = Buffer.from(encrypted_flow_data, 'base64')
    iv = Buffer.from(initial_vector, 'base64')
    const authTag = encryptedData.slice(-16)
    const ciphertext = encryptedData.slice(0, -16)
    const decipher = crypto.createDecipheriv('aes-128-gcm', aesKey, iv)
    decipher.setAuthTag(authTag)
    flowPayload = JSON.parse(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf-8')
    )
  } catch (err) {
    console.error('[Flow] Decryption failed:', err)
    res.status(421).send('Decryption failed')
    return
  }

  console.log('[Flow] action:', flowPayload.action)

  // Encrypt and send a response using the same AES key (flipped IV)
  const encryptResponse = (data: unknown): string => {
    const flippedIv = Buffer.from((iv as Buffer).map((b: number) => ~b & 0xff))
    const cipher = crypto.createCipheriv('aes-128-gcm', aesKey as Buffer, flippedIv)
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(data), 'utf-8'), cipher.final()])
    return Buffer.concat([encrypted, cipher.getAuthTag()]).toString('base64')
  }

  // Health check ping from Meta
  if (flowPayload.action === 'ping') {
    res.send(encryptResponse({ data: { status: 'active' } }))
    return
  }

  if (flowPayload.action !== 'data_exchange') {
    console.warn('[Flow] Unexpected action:', flowPayload.action)
    res.status(400).send('Unexpected action')
    return
  }

  const { pin, transaction_id } = flowPayload.data || {}
  if (!pin || !transaction_id) {
    console.error('[Flow] Missing pin or transaction_id in payload')
    res.status(400).send('Missing required fields')
    return
  }

  // Look up the pending cashout stored when the Flow message was sent
  const redis = getRedisClient()
  const pendingRaw = await redis.get(`flow:cashout:${transaction_id}`)
  if (!pendingRaw) {
    console.error('[Flow] No pending cashout for transaction_id:', transaction_id)
    res.send(encryptResponse({
      version: '3.0',
      screen: 'CONFIRM_CASHOUT',
      data: {
        has_error: true,
        error_message: 'Transaction expired. Please start a new cashout.',
      },
    }))
    return
  }

  const pending = JSON.parse(pendingRaw)
  const zeuspay = new ZeusPayService()

  // Verify PIN
  let pinToken: string
  try {
    pinToken = await zeuspay.verifyPin(pending.phone, pin, pending.partnerApiKey)
  } catch (err: any) {
    let errorMessage = 'Incorrect PIN. Please try again.'
    if (err.code === 'WRONG_PIN' && err.details?.attemptsRemaining !== undefined) {
      errorMessage = `Incorrect PIN. ${err.details.attemptsRemaining} attempt(s) remaining.`
    } else if (err.code === 'PIN_LOCKED') {
      errorMessage = 'PIN locked due to too many wrong attempts. Try again in 30 minutes.'
    } else if (err.code === 'PIN_NOT_SET') {
      errorMessage = 'No PIN set. Please message the bot to set your PIN first.'
    }
    res.send(encryptResponse({
      version: '3.0',
      screen: 'CONFIRM_CASHOUT',
      data: { has_error: true, error_message: errorMessage },
    }))
    return
  }

  // Execute cashout
  try {
    await zeuspay.cashout({
      phone: pending.phone,
      asset: pending.asset,
      cryptoAmount: pending.cryptoAmount,
      pinToken,
      bankCode: pending.bankCode,
      accountNumber: pending.accountNumber,
      accountName: pending.accountName,
      apiKey: pending.partnerApiKey,
    })

    await redis.del(`flow:cashout:${transaction_id}`)
    await sessions.clear(pending.phone, pending.partnerId)

    res.send(encryptResponse({
      version: '3.0',
      screen: 'SUCCESS',
      data: {
        ngn_amount: pending.ngnAmount,
        bank_name: pending.bankName,
        account_last4: pending.accountLast4,
      },
    }))
  } catch (err: any) {
    console.error('[Flow] Cashout execution failed:', err)
    const errorMessage = err.code === 'INSUFFICIENT_BALANCE'
      ? 'Insufficient balance. Please check your balance and try again.'
      : 'Cashout failed. Please try again shortly.'
    res.send(encryptResponse({
      version: '3.0',
      screen: 'CONFIRM_CASHOUT',
      data: { has_error: true, error_message: errorMessage },
    }))
  }
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
