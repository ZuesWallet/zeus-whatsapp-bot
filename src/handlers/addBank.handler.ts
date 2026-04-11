import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

export async function addBankHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  // Cancel from any step
  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cancelled. Type *help* for options.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // STEP: entry or AWAITING_DETAILS — show prompt
  if (!session.flow || !session.step || session.step === 'AWAITING_DETAILS') {
    // First entry: prompt for details
    if (!session.flow || !session.step) {
      return {
        reply:
          '🏦 *Add Bank Account*\n\n' +
          'Reply with your *bank code* and *account number* separated by a space.\n\n' +
          'Example: *044 0123456789*\n\n' +
          'Common bank codes:\n' +
          '044 — Access Bank\n' +
          '058 — GTBank\n' +
          '011 — First Bank\n' +
          '033 — UBA\n' +
          '068 — Standard Chartered\n\n' +
          'Type *cancel* to abort.',
        newSession: { flow: 'ADD_BANK', step: 'AWAITING_DETAILS', data: {} },
      }
    }

    // AWAITING_DETAILS: parse bank code + account number
    const parts = message.body.trim().split(/\s+/)
    if (parts.length !== 2 || !/^\d{3}$/.test(parts[0]) || !/^\d{10}$/.test(parts[1])) {
      return {
        reply: 'Please send in the correct format.\n\nExample: *044 0123456789*',
        newSession: session,
      }
    }

    const [bankCode, accountNumber] = parts
    let accountName: string
    try {
      const resolved = await zeuspay.resolveBank(accountNumber, bankCode, config.partnerApiKey)
      accountName = resolved.accountName
    } catch {
      return {
        reply: '⚠️ Could not verify that account. Please check the bank code and account number.',
        newSession: session,
      }
    }

    return {
      reply:
        `✅ *Confirm Bank Account*\n\n` +
        `Name: *${accountName}*\n` +
        `Account: ••••${accountNumber.slice(-4)}\n\n` +
        `Reply *yes* to save, or *cancel* to abort.`,
      newSession: {
        flow: 'ADD_BANK',
        step: 'AWAITING_CONFIRM',
        data: { bankCode, accountNumber, accountName },
      },
    }
  }

  // STEP: AWAITING_CONFIRM
  if (session.step === 'AWAITING_CONFIRM') {
    if (!['yes', 'y', 'confirm', 'ok'].includes(message.body.trim().toLowerCase())) {
      return {
        reply: 'Reply *yes* to confirm or *cancel* to abort.',
        newSession: session,
      }
    }

    try {
      await zeuspay.saveBankAccount({
        phone: message.from,
        bankCode: session.data.bankCode!,
        accountNumber: session.data.accountNumber!,
        accountName: session.data.accountName!,
        apiKey: config.partnerApiKey,
      })
    } catch {
      return {
        reply: '⚠️ Could not save your bank account right now. Please try again.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    return {
      reply:
        `✅ *Bank account saved!*\n\n` +
        `${session.data.accountName} — ••••${session.data.accountNumber!.slice(-4)}\n\n` +
        `You can now cash out to this account. Type *cash out [amount]* to start.`,
      newSession: { flow: null, step: null, data: {} },
    }
  }

  return {
    reply: 'Type *help* for available commands.',
    newSession: { flow: null, step: null, data: {} },
  }
}
