import { ZeusPayService } from '../services/zeuspay.service'
import { metaService } from '../services/meta.service'
import { getRedisClient } from '../lib/redis'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()

export async function handleOnboarding(
  input: HandlerInput,
  force = false
): Promise<HandlerOutput | null> {
  const { message, config } = input
  const redis = getRedisClient()

  if (!message.body && !message.isWelcomeRequest && !force) return null

  const onboardedKey = `onboarded:${message.from}:${config.partnerId}`
  const isOnboarded = await redis.get(onboardedKey)

  // ── Returning user (PIN already set, Redis key present) ───────────────────
  // Don't re-run onboarding. For silent messages return null; for forced calls
  // (greeting or chat-open) send a brief welcome-back + command list.
  if (isOnboarded) {
    if (!force) return null

    const firstName = (message.contactName || 'there').split(' ')[0]

    if (message.isWelcomeRequest) {
      return {
        reply:
          `Welcome back, ${firstName}! 👋\n\n` +
          `Type */help* to see everything you can do.`,
        newSession: { flow: null, step: null, data: {} },
      }
    }

    // User greeted ("hi", "hello", etc.)
    return {
      reply: buildCommandList(firstName, config.botName),
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── New or unverified user — fetch profile ────────────────────────────────
  let profile: Awaited<ReturnType<typeof zeuspay.getUserProfile>>
  try {
    profile = await zeuspay.getUserProfile(message.from, config.partnerApiKey)
  } catch {
    return null
  }

  const displayName = message.contactName || profile.fullName || message.from
  const firstName = displayName.split(' ')[0]

  // ── No PIN set — prompt setup ─────────────────────────────────────────────
  if (!profile.hasPinSet) {
    if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
      const safePhone = message.from.replace(/\+/g, '')
      const flowToken = `setpin_${safePhone}_${Date.now()}`

      await redis.set(
        `flow:setpin:${flowToken}`,
        JSON.stringify({ phone: message.from, partnerId: config.partnerId }),
        'EX',
        600
      )

      await metaService.send({
        to: message.from,
        from: config.metaCredentials.phoneNumberId,
        body:
          `Welcome to ${config.botName}! 👋\n\n` +
          `🔐 Please set up a 6-digit transaction PIN to secure your wallet.`,
        accessToken: config.metaCredentials.accessToken,
        phoneNumberId: config.metaCredentials.phoneNumberId,
      })

      await new Promise(r => setTimeout(r, 1000))

      try {
        await metaService.sendFlow({
          to: message.from,
          phoneNumberId: config.metaCredentials.phoneNumberId,
          accessToken: config.metaCredentials.accessToken,
          flowId: process.env.META_SET_PIN_FLOW_ID!,
          flowCta: 'Set Up PIN',
          screenId: 'SET_PIN',
          flowData: { user_name: firstName },
          flowToken,
        })
      } catch (flowErr) {
        console.error('[onboarding] sendFlow failed — falling back to /setpin prompt', flowErr)
        await metaService.send({
          to: message.from,
          from: config.metaCredentials.phoneNumberId,
          body: 'Type */setpin* to create your 6-digit transaction PIN.',
          accessToken: config.metaCredentials.accessToken,
          phoneNumberId: config.metaCredentials.phoneNumberId,
        })
      }

      return {
        reply: '',
        newSession: {
          flow: 'ONBOARDING_PIN',
          step: 'AWAITING_FLOW',
          data: { flowToken, firstName } as any,
        },
      }
    }

    return {
      reply:
        `Welcome to ${config.botName}! 👋\n\n` +
        `🔐 Please set up a transaction PIN to secure your wallet.\n\n` +
        `Type *set pin* to get started.`,
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── PIN is set — mark onboarded and send welcome ──────────────────────────
  await redis.set(onboardedKey, '1')

  return {
    reply: buildCommandList(firstName, config.botName),
    newSession: { flow: null, step: null, data: {} },
  }
}

function buildCommandList(firstName: string, botName?: string | null): string {
  return (
    `Hey ${firstName}! 👋\n\n` +
    `Here's what you can do${botName ? ` with *${botName}*` : ''}:\n\n` +
    `✅ *Check balance* — /balance\n` +
    `✅ *Deposit crypto* — /wallet\n` +
    `✅ *Sell crypto* — /withdraw\n` +
    `✅ *Check rate* — /rate\n` +
    `✅ *Transaction history* — /history\n` +
    `✅ *Add bank account* — /addbank\n\n` +
    `_Type /help anytime to see this menu._`
  )
}

export async function sendHelpGuide(
  phone: string,
  config: HandlerInput['config'],
  firstName?: string
): Promise<void> {
  if (config.bspType !== 'META_CLOUD' || !config.metaCredentials) return

  await metaService.send({
    to: phone,
    from: config.metaCredentials.phoneNumberId,
    body: buildCommandList(firstName || 'there', config.botName),
    accessToken: config.metaCredentials.accessToken,
    phoneNumberId: config.metaCredentials.phoneNumberId,
  })
}
