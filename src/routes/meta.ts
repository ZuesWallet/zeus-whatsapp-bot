import { Router, Request, Response } from 'express'
import { RoutingService } from '../services/routing.service'
import { SessionService } from '../services/session.service'
import { sendMessage, sendMessageWithImage } from '../services/sender.service'
import { generateReceipt } from '../services/receipt.service'
import { dispatch } from '../handlers'
import { sendHelpGuide } from '../handlers/onboarding.handler'
import { getRedisClient } from '../lib/redis'
import { metaService } from '../services/meta.service'
import type { InboundMessage, Session, PartnerConfig } from '../types'

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
            const from = '+' + message.from
            const messageId = message.id
            if (!from || !messageId) continue

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

            const contactName = value.contacts?.[0]?.profile?.name ?? ''

            // ── request_welcome — Meta fires this when user opens chat for first time
            if (message.type === 'request_welcome') {
              const inbound: InboundMessage = {
                from,
                to: metadata.display_phone_number,
                body: '',
                messageId,
                timestamp: Date.now(),
                contactName,
                isWelcomeRequest: true,
              }

              const session = await sessions.get(inbound.from, config.partnerId)
              const output = await dispatch(inbound, session, config)

              if (output.newSession !== undefined) {
                if (!output.newSession?.flow && !output.newSession?.step) {
                  await sessions.clear(inbound.from, config.partnerId)
                } else {
                  await sessions.set(inbound.from, config.partnerId, output.newSession)
                }
              }

              if (output.reply && config.metaCredentials) {
                await metaService.send({
                  to: inbound.from,
                  from: metadata.phone_number_id,
                  body: output.reply,
                  accessToken: config.metaCredentials.accessToken,
                  phoneNumberId: config.metaCredentials.phoneNumberId,
                })
              }
              continue
            }

            // ── nfm_reply — user completed a Flow (tapped Done/Continue)
            if (
              message.type === 'interactive' &&
              (message.interactive as any)?.type === 'nfm_reply'
            ) {
              const nfmReply = (message.interactive as any).nfm_reply
              const responseData = JSON.parse(nfmReply?.response_json || '{}')
              const flowToken: string = responseData.flow_token ?? ''

              // PIN setup Flow completed
              if (flowToken.startsWith('setpin_')) {
                if (config.metaCredentials) {
                  await metaService.send({
                    to: from,
                    from: metadata.phone_number_id,
                    body: '🚀 Securing your account 🔐...',
                    accessToken: config.metaCredentials.accessToken,
                    phoneNumberId: config.metaCredentials.phoneNumberId,
                  })

                  await new Promise(r => setTimeout(r, 1500))

                  await metaService.send({
                    to: from,
                    from: metadata.phone_number_id,
                    body:
                      'All set! 🎉 Now your wallet is secure. ' +
                      "Keep your PIN private — it's your key to staying secure.",
                    accessToken: config.metaCredentials.accessToken,
                    phoneNumberId: config.metaCredentials.phoneNumberId,
                  })

                  await new Promise(r => setTimeout(r, 1000))

                  await sendHelpGuide(from, config)
                }

                await sessions.clear(from, config.partnerId)
                continue
              }

              // Cashout Flow completed — existing behaviour
              const session = await sessions.get(from, config.partnerId)
              if (session?.step === 'AWAITING_FLOW_SENT') {
                const d = session.data
                const est = d.estimate
                const bankName = d.bankName || ''
                const last4 = (d.accountNumber || '').slice(-4) || '****'
                const asset = (d.asset || '').replace('_ERC20', '').replace('_TRC20', '').replace('_BASE', '')
                const ngnFormatted = parseFloat(String(est?.ngnAmount || '0')).toLocaleString('en-NG', {
                  minimumFractionDigits: 2, maximumFractionDigits: 2,
                })

                const confirmText =
                  `✅ *Transaction Confirmed!*\n\n` +
                  `₦${ngnFormatted} is on its way to your ${bankName} account ending ••••${last4}.\n\n` +
                  `This usually takes under 5 minutes. You'll receive a receipt once the transfer is complete.`

                await sendMessage(from, confirmText, config)

                if (d.transactionId && est) {
                  try {
                    const receiptBuffer = await generateReceipt({
                      transactionId: String(d.transactionId),
                      asset,
                      cryptoAmount: String(est.cryptoAmount || '0'),
                      ngnAmount: ngnFormatted,
                      bankName,
                      accountNumber: last4,
                      rate: String(est.rateUsed || '0'),
                      fee: String(est.feeAmountNgn || '0'),
                      completedAt: new Date().toISOString(),
                      botName: config.botName || 'GoGet',
                    })
                    await sendMessageWithImage(from, '📄 Your cashout receipt', receiptBuffer, config, '')
                  } catch (receiptErr) {
                    console.error('[meta] nfm_reply: receipt generation failed', receiptErr)
                  }
                }

                await sessions.clear(from, config.partnerId)
              }
              continue
            }

            // ── button_reply — user tapped a reply button
            if (
              message.type === 'interactive' &&
              (message.interactive as any)?.type === 'button_reply'
            ) {
              const buttonReply = (message.interactive as any).button_reply
              const inbound: InboundMessage = {
                from,
                to: metadata.display_phone_number,
                body: buttonReply.id,
                messageId,
                timestamp: Date.now(),
                contactName,
              }
              const session = await sessions.get(from, config.partnerId)
              await dispatchAndReply(inbound, session, config, from, metadata.phone_number_id)
              continue
            }

            // ── list_reply — user selected a list item
            if (
              message.type === 'interactive' &&
              (message.interactive as any)?.type === 'list_reply'
            ) {
              const listReply = (message.interactive as any).list_reply
              const inbound: InboundMessage = {
                from,
                to: metadata.display_phone_number,
                body: listReply.id,
                messageId,
                timestamp: Date.now(),
                contactName,
              }
              const session = await sessions.get(from, config.partnerId)
              await dispatchAndReply(inbound, session, config, from, metadata.phone_number_id)
              continue
            }

            if (message.type !== 'text') continue

            const messageBody = message.text?.body || ''
            if (!messageBody) continue

            const session = await sessions.get(from, config.partnerId)

            const inbound: InboundMessage = {
              from,
              to: metadata.display_phone_number,
              body: messageBody,
              messageId,
              timestamp: Date.now(),
              contactName,
            }

            await dispatchAndReply(inbound, session, config, from, metadata.phone_number_id)
          }
        }
      }
    } catch (err) {
      console.error('[Meta] Unhandled error processing webhook:', err)
    }
  })()
})

async function dispatchAndReply(
  inbound: InboundMessage,
  session: Session,
  config: PartnerConfig,
  from: string,
  phoneNumberId: string
): Promise<void> {
  const output = await dispatch(inbound, session, config)

  if (output.newSession !== undefined) {
    if (output.newSession === null || (!output.newSession.flow && !output.newSession.step)) {
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
  contacts?: Array<{ profile?: { name?: string } }>
  messages?: MetaMessage[]
}

interface MetaMessage {
  id: string
  from: string
  timestamp: string
  type: string
  text?: { body: string }
  interactive?: unknown
}

export default router
