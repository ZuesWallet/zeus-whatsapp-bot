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

  // Skip for non-forced messages if already onboarded.
  // PIN-less users never get this key set, so they always see the PIN prompt.
  if (isOnboarded && !force) return null

  let profile: Awaited<ReturnType<typeof zeuspay.getUserProfile>>
  try {
    profile = await zeuspay.getUserProfile(message.from, config.partnerApiKey)
  } catch {
    return null
  }

  const displayName = message.contactName || profile.fullName || message.from
  const firstName = displayName.split(' ')[0]

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
          `Welcome back ${displayName}! 👋\n\n` +
          `🔐 We've improved security on your wallet. ` +
          `Please set up a transaction PIN to secure your account.`,
        accessToken: config.metaCredentials.accessToken,
        phoneNumberId: config.metaCredentials.phoneNumberId,
      })

      await new Promise(r => setTimeout(r, 1000))

      // Wrap sendFlow — if the Flow ID isn't configured yet, send a text fallback
      // so the welcome message doesn't hang without a follow-up.
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
        `Welcome back ${displayName}! 👋\n\n` +
        `🔐 We've improved security on your wallet. ` +
        `Please set up a transaction PIN.\n\n` +
        `Type *set pin* to get started.`,
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // Returning user with PIN set — mark as onboarded so future messages skip this check
  await redis.set(onboardedKey, '1')

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.send({
      to: message.from,
      from: config.metaCredentials.phoneNumberId,
      body: `Welcome back ${firstName}! 👋`,
      accessToken: config.metaCredentials.accessToken,
      phoneNumberId: config.metaCredentials.phoneNumberId,
    })
    await new Promise(r => setTimeout(r, 800))
    await sendHelpGuide(message.from, config, firstName)
  }

  return {
    reply: '',
    newSession: { flow: null, step: null, data: {} },
  }
}

export async function sendHelpGuide(
  phone: string,
  config: HandlerInput['config'],
  firstName?: string
): Promise<void> {
  if (config.bspType !== 'META_CLOUD' || !config.metaCredentials) return

  const greeting = firstName ? `All set, ${firstName}! 🎉\n\n` : ''

  await metaService.send({
    to: phone,
    from: config.metaCredentials.phoneNumberId,
    body:
      `${greeting}Here is what you can do with *${config.botName}*.\n\n` +
      `✅ *Check balance* — /balance\n` +
      `✅ *Deposit crypto* — /wallet\n` +
      `✅ *Sell crypto* — /withdraw\n` +
      `✅ *Check rate* — /rate\n` +
      `✅ *Transaction history* — /history\n` +
      `✅ *Add bank account* — /addbank\n\n` +
      `_Type /help anytime to see this menu._`,
    accessToken: config.metaCredentials.accessToken,
    phoneNumberId: config.metaCredentials.phoneNumberId,
  })
}
