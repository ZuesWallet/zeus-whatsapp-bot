import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

async function buildBankListReply(apiKey: string): Promise<string> {
  const banks = await zeuspay.getBanks(apiKey)
  let reply = '🏦 *Add Bank Account*\n\nSelect your bank:\n\n'
  banks.forEach((b, i) => {
    reply += `${i + 1}. ${b.name}\n`
  })
  reply += '\n_Reply with the number next to your bank._\n\nType *cancel* to abort.'
  return reply
}

export async function addBankHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cancelled. Type *help* for options.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── Entry: fetch bank list and show it ────────────────────────────────────
  if (!session.step) {
    try {
      const reply = await buildBankListReply(config.partnerApiKey)
      return {
        reply,
        newSession: {
          flow: 'ADD_BANK',
          step: 'AWAITING_BANK_SELECT',
          data: {},
        },
      }
    } catch {
      return {
        reply: '⚠️ Could not load bank list right now. Please try again.',
        newSession: { flow: null, step: null, data: {} },
      }
    }
  }

  // ── AWAITING_BANK_SELECT: user picks a number ─────────────────────────────
  if (session.step === 'AWAITING_BANK_SELECT') {
    // Re-fetch to get consistent list
    let banks: { code: string; name: string }[] = []
    try {
      banks = await zeuspay.getBanks(config.partnerApiKey)
    } catch {
      return {
        reply: '⚠️ Could not load bank list. Please try again.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    const num = parseInt(message.body.trim())
    if (isNaN(num) || num < 1 || num > banks.length) {
      return {
        reply: `Please reply with a number between 1 and ${banks.length}.`,
        newSession: session,
      }
    }

    const selected = banks[num - 1]
    return {
      reply:
        `✅ *${selected.name}* selected.\n\n` +
        `Now enter your *10-digit account number*:\n\n` +
        `Type *cancel* to abort.`,
      newSession: {
        flow: 'ADD_BANK',
        step: 'AWAITING_ACCOUNT_NUMBER',
        data: { bankCode: selected.code, bankName: selected.name },
      },
    }
  }

  // ── AWAITING_ACCOUNT_NUMBER: user enters account number ───────────────────
  if (session.step === 'AWAITING_ACCOUNT_NUMBER') {
    const accountNumber = message.body.trim().replace(/\s+/g, '')
    if (!/^\d{10}$/.test(accountNumber)) {
      return {
        reply: 'Account number must be exactly 10 digits. Please try again or type *cancel*.',
        newSession: session,
      }
    }

    let accountName: string
    try {
      const resolved = await zeuspay.resolveBank(accountNumber, session.data.bankCode!, config.partnerApiKey)
      accountName = resolved.accountName
    } catch {
      return {
        reply: '⚠️ Could not verify that account number. Please check and try again, or type *cancel*.',
        newSession: session,
      }
    }

    return {
      reply:
        `✅ *Confirm Bank Account*\n\n` +
        `Bank: ${session.data.bankName}\n` +
        `Name: *${accountName}*\n` +
        `Account: ••••${accountNumber.slice(-4)}\n\n` +
        `Reply *yes* to save, or *cancel* to abort.`,
      newSession: {
        flow: 'ADD_BANK',
        step: 'AWAITING_CONFIRM',
        data: { ...session.data, accountNumber, accountName },
      },
    }
  }

  // ── AWAITING_CONFIRM: save account ────────────────────────────────────────
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
