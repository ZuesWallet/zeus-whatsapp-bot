import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import { metaService } from '../services/meta.service'
import { getRedisClient } from '../lib/redis'
import { matchBanks } from '../lib/bankMatch'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

export async function addBankHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cancelled. Type *help* for options.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── META_CLOUD entry — send the Add Bank Flow ─────────────────────────────
  if (!session.step && config.bspType === 'META_CLOUD' && config.metaCredentials) {
    let banks: { code: string; name: string }[] = []
    try {
      banks = await zeuspay.getBanks(config.partnerApiKey)
    } catch {
      return {
        reply: '⚠️ Could not load bank list right now. Please try again.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    const bankRows = banks.map(b => ({ id: b.code, title: b.name }))
    const safePhone = message.from.replace(/\+/g, '')
    const flowToken = `addbank_${safePhone}_${Date.now()}`
    const redis = getRedisClient()

    await redis.set(
      `flow:addbank:${flowToken}`,
      JSON.stringify({ phone: message.from, partnerId: config.partnerId, banks: bankRows }),
      'EX',
      600
    )

    try {
      await metaService.sendFlow({
        to: message.from,
        phoneNumberId: config.metaCredentials.phoneNumberId,
        accessToken: config.metaCredentials.accessToken,
        flowId: process.env.META_ADD_BANK_FLOW_ID!,
        flowCta: 'Add Bank Account',
        screenId: '',
        flowData: {},
        flowToken,
        bodyText: 'Tap the button below to add your bank account.',
      })
    } catch (err) {
      console.error('[addBank] sendFlow failed', err)
      // Fall through to text-based flow below by clearing session and retrying
      await redis.del(`flow:addbank:${flowToken}`)
      return {
        reply:
          '🏦 *Add Bank Account*\n\n' +
          'What is the name of your bank?\n\n' +
          '_e.g. GTBank, Access Bank, Zenith, UBA_\n\n' +
          'Type *cancel* to abort.',
        newSession: { flow: 'ADD_BANK', step: 'AWAITING_BANK_NAME', data: {} },
      }
    }

    return {
      reply: '',
      newSession: { flow: 'ADD_BANK', step: 'AWAITING_FLOW', data: {} },
    }
  }

  // ── AWAITING_FLOW — waiting for Flow completion (Meta only) ───────────────
  if (session.step === 'AWAITING_FLOW') {
    return {
      reply: '📱 Please complete the bank account form in the screen above.',
      newSession: session,
    }
  }

  // ── Legacy step: old AWAITING_BANK_SELECT — restart cleanly ──────────────
  if (session.step === 'AWAITING_BANK_SELECT') {
    return {
      reply:
        '🏦 *Add Bank Account*\n\n' +
        'What is the name of your bank?\n\n' +
        '_e.g. GTBank, Access Bank, Zenith, UBA_\n\n' +
        'Type *cancel* to abort.',
      newSession: {
        flow: 'ADD_BANK',
        step: 'AWAITING_BANK_NAME',
        data: {},
      },
    }
  }

  // ── Entry: ask for bank name ──────────────────────────────────────────────
  if (!session.step) {
    return {
      reply:
        '🏦 *Add Bank Account*\n\n' +
        'What is the name of your bank?\n\n' +
        '_e.g. GTBank, Access Bank, Zenith, UBA_\n\n' +
        'Type *cancel* to abort.',
      newSession: {
        flow: 'ADD_BANK',
        step: 'AWAITING_BANK_NAME',
        data: {},
      },
    }
  }

  // ── AWAITING_BANK_NAME: match user's typed name against bank list ──────────
  if (session.step === 'AWAITING_BANK_NAME') {
    let banks: { code: string; name: string }[] = []
    try {
      banks = await zeuspay.getBanks(config.partnerApiKey)
    } catch {
      return {
        reply: '⚠️ Could not verify banks right now. Please try again.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    const matches = matchBanks(message.body.trim(), banks)

    if (matches.length === 0) {
      return {
        reply:
          '❓ No bank found for *' + message.body.trim() + '*.\n\n' +
          'Please try again with a different spelling, or type *cancel* to abort.',
        newSession: session,
      }
    }

    if (matches.length === 1) {
      const bank = matches[0]
      return {
        reply:
          `✅ *${bank.name}*\n\n` +
          `Now enter your *10-digit account number*:\n\n` +
          `Type *cancel* to abort.`,
        newSession: {
          flow: 'ADD_BANK',
          step: 'AWAITING_ACCOUNT_NUMBER',
          data: { bankCode: bank.code, bankName: bank.name },
        },
      }
    }

    // Multiple matches — show up to 3 and ask to pick
    const shortList = matches.slice(0, 3)
    let reply = `Found ${matches.length > 3 ? 'several' : matches.length} banks matching *${message.body.trim()}*:\n\n`
    shortList.forEach((b, i) => {
      reply += `${i + 1}. ${b.name}\n`
    })
    if (matches.length > 3) {
      reply += '\nPlease be more specific, or reply with the number above.'
    } else {
      reply += '\nReply with the number, or type *cancel* to abort.'
    }

    return {
      reply,
      newSession: {
        flow: 'ADD_BANK',
        step: 'AWAITING_BANK_DISAMBIGUATE',
        data: { shortList: shortList.map((b) => ({ code: b.code, name: b.name })) },
      },
    }
  }

  // ── AWAITING_BANK_DISAMBIGUATE: user picks from short list ────────────────
  if (session.step === 'AWAITING_BANK_DISAMBIGUATE') {
    const shortList = (session.data.shortList ?? []) as { code: string; name: string }[]
    const num = parseInt(message.body.trim())

    if (isNaN(num) || num < 1 || num > shortList.length) {
      // Maybe they typed a new search term — go back to matching
      let banks: { code: string; name: string }[] = []
      try {
        banks = await zeuspay.getBanks(config.partnerApiKey)
      } catch {
        return {
          reply: '⚠️ Could not verify banks right now. Please try again.',
          newSession: { flow: null, step: null, data: {} },
        }
      }

      const matches = matchBanks(message.body.trim(), banks)

      if (matches.length === 1) {
        const bank = matches[0]
        return {
          reply:
            `✅ *${bank.name}*\n\n` +
            `Now enter your *10-digit account number*:\n\n` +
            `Type *cancel* to abort.`,
          newSession: {
            flow: 'ADD_BANK',
            step: 'AWAITING_ACCOUNT_NUMBER',
            data: { bankCode: bank.code, bankName: bank.name },
          },
        }
      }

      return {
        reply: `Please reply with a number (1–${shortList.length}), or type *cancel* to abort.`,
        newSession: session,
      }
    }

    const bank = shortList[num - 1]
    return {
      reply:
        `✅ *${bank.name}*\n\n` +
        `Now enter your *10-digit account number*:\n\n` +
        `Type *cancel* to abort.`,
      newSession: {
        flow: 'ADD_BANK',
        step: 'AWAITING_ACCOUNT_NUMBER',
        data: { bankCode: bank.code, bankName: bank.name },
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
        reply: '⚠️ Could not verify that account. Please check the number and try again, or type *cancel*.',
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
        `You can now cash out. Type *cash out [amount]* to start.`,
      newSession: { flow: null, step: null, data: {} },
    }
  }

  return {
    reply: 'Type *help* for available commands.',
    newSession: { flow: null, step: null, data: {} },
  }
}
