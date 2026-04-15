import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

// ─────────────────────────────────────────────────────────
// SET PIN  — first time, no existing PIN
// ─────────────────────────────────────────────────────────
export async function setPinHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input

  if (intentSvc.parse(message.body).type === 'CANCEL') {
    return { reply: '❌ Cancelled.', newSession: { flow: null, step: null, data: {} } }
  }

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

  if (session.step === 'AWAITING_PIN') {
    if (!/^\d{6}$/.test(message.body.trim())) {
      return { reply: 'PIN must be exactly 6 digits. Try again or type *cancel*.', newSession: session }
    }
    return {
      reply: '🔐 Confirm your PIN by entering it again:',
      newSession: { flow: 'SET_PIN', step: 'AWAITING_CONFIRM', data: { pin: message.body.trim() } },
    }
  }

  if (session.step === 'AWAITING_CONFIRM') {
    if (!/^\d{6}$/.test(message.body.trim())) {
      return { reply: 'PIN must be exactly 6 digits. Enter it again or type *cancel*.', newSession: session }
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
        // PIN already set — guide them to the right command
        return {
          reply:
            '⚠️ You already have a PIN.\n\n' +
            'Type *change pin* if you know your current PIN.\n' +
            'Type *forgot pin* if you\'ve lost it.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      return { reply: '⚠️ Could not set PIN right now. Please try again.', newSession: { flow: null, step: null, data: {} } }
    }

    return {
      reply:
        '✅ *PIN set successfully!*\n\n' +
        'You\'ll use this PIN to confirm cashouts.\n\n' +
        'Type *cash out [amount]* to start.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  return { reply: 'Type *help* for available commands.', newSession: { flow: null, step: null, data: {} } }
}

// ─────────────────────────────────────────────────────────
// CHANGE PIN  — knows current PIN, wants a new one
// ─────────────────────────────────────────────────────────
export async function changePinHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input

  if (intentSvc.parse(message.body).type === 'CANCEL') {
    return { reply: '❌ Cancelled.', newSession: { flow: null, step: null, data: {} } }
  }

  if (!session.step) {
    return {
      reply:
        '🔐 *Change PIN*\n\n' +
        'Enter your *current* 6-digit PIN:\n\n' +
        'Type *cancel* to abort.',
      newSession: { flow: 'CHANGE_PIN', step: 'AWAITING_CURRENT', data: {} },
    }
  }

  if (session.step === 'AWAITING_CURRENT') {
    if (!/^\d{6}$/.test(message.body.trim())) {
      return { reply: 'PIN must be exactly 6 digits. Try again or type *cancel*.', newSession: session }
    }
    return {
      reply: '🔐 Now enter your *new* 6-digit PIN:',
      newSession: { flow: 'CHANGE_PIN', step: 'AWAITING_NEW', data: { currentPin: message.body.trim() } },
    }
  }

  if (session.step === 'AWAITING_NEW') {
    if (!/^\d{6}$/.test(message.body.trim())) {
      return { reply: 'PIN must be exactly 6 digits. Try again or type *cancel*.', newSession: session }
    }
    if (message.body.trim() === session.data.currentPin) {
      return { reply: '⚠️ New PIN must be different from your current PIN. Enter a new PIN:', newSession: session }
    }
    return {
      reply: '🔐 Confirm your new PIN:',
      newSession: { flow: 'CHANGE_PIN', step: 'AWAITING_CONFIRM', data: { ...session.data, newPin: message.body.trim() } },
    }
  }

  if (session.step === 'AWAITING_CONFIRM') {
    if (message.body.trim() !== session.data.newPin) {
      return {
        reply: '❌ PINs don\'t match. Enter your new PIN again:',
        newSession: { flow: 'CHANGE_PIN', step: 'AWAITING_NEW', data: { currentPin: session.data.currentPin } },
      }
    }

    try {
      await zeuspay.changePin(message.from, session.data.currentPin!, session.data.newPin!, config.partnerApiKey)
    } catch (err: any) {
      if (err.code === 'WRONG_PIN') {
        const remaining = err.details?.attemptsRemaining
        const hint = remaining !== undefined ? ` ${remaining} attempt(s) remaining.` : ''
        return {
          reply: `❌ Incorrect current PIN.${hint}\n\nTry again or type *cancel*.\n\nForgot your PIN? Type *forgot pin*.`,
          newSession: { flow: 'CHANGE_PIN', step: 'AWAITING_CURRENT', data: {} },
        }
      }
      if (err.code === 'PIN_LOCKED') {
        return {
          reply: '🔒 PIN locked due to too many wrong attempts. Try again in 30 minutes.\n\nOr type *forgot pin* to reset it.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      return { reply: '⚠️ Could not change PIN right now. Please try again.', newSession: { flow: null, step: null, data: {} } }
    }

    return {
      reply: '✅ *PIN changed successfully!*',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  return { reply: 'Type *help* for available commands.', newSession: { flow: null, step: null, data: {} } }
}

// ─────────────────────────────────────────────────────────
// FORGOT PIN  — WhatsApp identity is sufficient to reset
// ─────────────────────────────────────────────────────────
export async function forgotPinHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input

  if (intentSvc.parse(message.body).type === 'CANCEL') {
    return { reply: '❌ Cancelled.', newSession: { flow: null, step: null, data: {} } }
  }

  if (!session.step) {
    return {
      reply:
        '🔐 *Reset PIN*\n\n' +
        'Since you\'re messaging from your verified WhatsApp number, ' +
        'we can reset your PIN directly.\n\n' +
        'Enter your new 6-digit PIN:\n\n' +
        'Type *cancel* to abort.',
      newSession: { flow: 'FORGOT_PIN', step: 'AWAITING_NEW', data: {} },
    }
  }

  if (session.step === 'AWAITING_NEW') {
    if (!/^\d{6}$/.test(message.body.trim())) {
      return { reply: 'PIN must be exactly 6 digits. Try again or type *cancel*.', newSession: session }
    }
    return {
      reply: '🔐 Confirm your new PIN:',
      newSession: { flow: 'FORGOT_PIN', step: 'AWAITING_CONFIRM', data: { newPin: message.body.trim() } },
    }
  }

  if (session.step === 'AWAITING_CONFIRM') {
    if (message.body.trim() !== session.data.newPin) {
      return {
        reply: '❌ PINs don\'t match. Enter your new PIN again:',
        newSession: { flow: 'FORGOT_PIN', step: 'AWAITING_NEW', data: {} },
      }
    }

    try {
      await zeuspay.resetPin(message.from, session.data.newPin!, config.partnerApiKey)
    } catch {
      return { reply: '⚠️ Could not reset PIN right now. Please try again.', newSession: { flow: null, step: null, data: {} } }
    }

    return {
      reply:
        '✅ *PIN reset successfully!*\n\n' +
        'You can now use your new PIN for cashouts.\n\n' +
        'Type *cash out [amount]* to start.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  return { reply: 'Type *help* for available commands.', newSession: { flow: null, step: null, data: {} } }
}
