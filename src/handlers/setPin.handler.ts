import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

export async function setPinHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cancelled. Type *help* for options.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // Entry point
  if (!session.step) {
    return {
      reply:
        '🔐 *Set Transaction PIN*\n\n' +
        'Choose a 6-digit PIN you\'ll use to confirm cashouts.\n\n' +
        '_Enter your PIN now:_\n\n' +
        'Type *cancel* to abort.',
      newSession: { flow: 'SET_PIN', step: 'AWAITING_PIN', data: {} },
    }
  }

  // Step 1: receive first PIN entry
  if (session.step === 'AWAITING_PIN') {
    if (!/^\d{6}$/.test(message.body.trim())) {
      return {
        reply: 'PIN must be exactly 6 digits. Try again or type *cancel*.',
        newSession: session,
      }
    }

    return {
      reply: '🔐 Confirm your PIN by entering it again:',
      newSession: {
        flow: 'SET_PIN',
        step: 'AWAITING_CONFIRM',
        data: { ...session.data, pin: message.body.trim() },
      },
    }
  }

  // Step 2: confirm PIN
  if (session.step === 'AWAITING_CONFIRM') {
    if (!/^\d{6}$/.test(message.body.trim())) {
      return {
        reply: 'PIN must be exactly 6 digits. Enter it again or type *cancel*.',
        newSession: session,
      }
    }

    if (message.body.trim() !== session.data.pin) {
      return {
        reply: '❌ PINs don\'t match. Let\'s start over — enter your new 6-digit PIN:',
        newSession: { flow: 'SET_PIN', step: 'AWAITING_PIN', data: {} },
      }
    }

    try {
      await zeuspay.setPin(message.from, session.data.pin!, config.partnerApiKey)
    } catch (err: any) {
      if (err.code === 'VALIDATION_ERROR') {
        return {
          reply: '⚠️ You already have a PIN set. Contact support to reset it.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      return {
        reply: '⚠️ Could not set PIN right now. Please try again.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    return {
      reply:
        '✅ *PIN set successfully!*\n\n' +
        'You\'ll use this PIN to confirm cashouts.\n\n' +
        'Type *cash out [amount]* to start cashing out.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  return {
    reply: 'Type *help* for available commands.',
    newSession: { flow: null, step: null, data: {} },
  }
}
