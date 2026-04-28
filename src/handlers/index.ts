import axios from 'axios'
import { IntentService } from '../services/intent.service'
import { helpHandler } from './help.handler'
import { rateHandler } from './rate.handler'
import { balanceHandler } from './balance.handler'
import { walletHandler } from './wallet.handler'
import { historyHandler } from './history.handler'
import { cashoutHandler } from './cashout.handler'
import { addBankHandler } from './addBank.handler'
import { setPinHandler, changePinHandler, forgotPinHandler } from './setPin.handler'
import { handleOnboarding } from './onboarding.handler'
import { withdrawHandler } from './withdraw.handler'
import type { InboundMessage, Session, PartnerConfig, HandlerOutput, WACommand } from '../types'

const intentSvc = new IntentService()

export async function dispatch(
  message: InboundMessage,
  session: Session,
  config: PartnerConfig
): Promise<HandlerOutput> {
  const input = { message, session, config }
  const intent = intentSvc.parse(message.body)

  // ── Onboarding check ──────────────────────────────────────────────────────
  // Force onboarding for ONBOARDING intent (ice breaker "Hi 👋" or greeting).
  // Also runs silently for every new user's first message.
  const forceOnboarding = intent.type === 'ONBOARDING' || !!message.isWelcomeRequest
  try {
    const onboardingResult = await handleOnboarding(input, forceOnboarding)
    if (onboardingResult !== null) return onboardingResult
  } catch {
    // If onboarding was forced (greeting or welcome request) and threw, don't fall
    // through to helpHandler — the welcome text may have already been sent.
    if (forceOnboarding) return { reply: '' }
  }

  // ── Active flow — route to flow handler regardless of intent (CANCEL handled inside) ──
  if (session.flow === 'CASHOUT') {
    return cashoutHandler(input)
  }

  if (session.flow === 'ADD_BANK') {
    return addBankHandler(input)
  }

  if (session.flow === 'SET_PIN') {
    return setPinHandler(input)
  }

  if (session.flow === 'CHANGE_PIN') {
    return changePinHandler(input)
  }

  if (session.flow === 'FORGOT_PIN') {
    return forgotPinHandler(input)
  }

  if (session.flow === 'WITHDRAW') {
    return withdrawHandler(input)
  }

  if (session.flow === 'ONBOARDING_PIN') {
    if (intent.type === 'CANCEL') {
      return {
        reply: '❌ PIN setup cancelled. Type /setpin to set it up later.',
        newSession: { flow: null, step: null, data: {} },
      }
    }
    return {
      reply: '📱 Please complete your PIN setup in the secure screen above.',
      newSession: session,
    }
  }

  // ── No active flow — check if command is enabled ──────────────────────────
  const commandToFeature: Record<string, WACommand> = {
    RATE:       'RATE',
    BALANCE:    'BALANCE',
    WALLET:     'WALLET',
    CASHOUT:    'CASHOUT',
    HISTORY:    'HISTORY',
    ADD_BANK:   'ADD_BANK',
    SET_PIN:    'SET_PIN',
    CHANGE_PIN: 'SET_PIN',
    FORGOT_PIN: 'SET_PIN',
    HELP:       'HELP',
    ONBOARDING: 'HELP',
  }

  const requiredFeature = commandToFeature[intent.type]
  const alwaysAvailable: WACommand[] = ['HELP', 'SET_PIN']
  if (requiredFeature && !alwaysAvailable.includes(requiredFeature) && !config.enabledCommands.includes(requiredFeature)) {
    return {
      reply: `That command is not available. Type *help* to see what's available.`,
      newSession: session,
    }
  }

  switch (intent.type) {
    case 'ONBOARDING':
      // Already handled above via forceOnboarding — if we reach here the user
      // is already onboarded, so show the help guide
      return helpHandler(input)
    case 'RATE':        return rateHandler(input)
    case 'BALANCE':     return balanceHandler(input)
    case 'WALLET':      return walletHandler(input)
    case 'HISTORY':     return historyHandler(input)
    case 'CASHOUT':     return withdrawHandler(input)
    case 'ADD_BANK':    return addBankHandler(input)
    case 'SET_PIN':     return setPinHandler(input)
    case 'CHANGE_PIN':  return changePinHandler(input)
    case 'FORGOT_PIN':  return forgotPinHandler(input)
    case 'HELP':
    case 'MENU_SELECT': return helpHandler(input)
    case 'CANCEL':
      return {
        reply: 'Nothing to cancel. Type *help* to see available commands.',
        newSession: session,
      }
    case 'PIN_ENTRY':
      return {
        reply: 'Nothing to confirm right now. Type *help* to see available commands.',
        newSession: session,
      }
    case 'UNKNOWN':
    default: {
      if (config.fallbackWebhook) {
        try {
          await axios.post(
            config.fallbackWebhook,
            {
              from: message.from,
              body: message.body,
              timestamp: message.timestamp,
              partnerId: config.partnerId,
            },
            { timeout: 5000 }
          )
          return { reply: '' }
        } catch {
          // Webhook failed — fall through to default message
        }
      }

      return {
        reply: config.fallbackMessage || `I didn't understand that. Type *help* to see available commands.`,
        newSession: session,
      }
    }
  }
}
