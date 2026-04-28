import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import { metaService } from '../services/meta.service'
import { getRedisClient } from '../lib/redis'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

export async function withdrawHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cancelled. Type /help for options.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── ENTRY — Currency selection via reply buttons ──────────────────────────
  if (!session.step || session.step === 'AWAITING_CURRENCY') {
    if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
      await metaService.sendButtons({
        to: message.from,
        phoneNumberId: config.metaCredentials.phoneNumberId,
        accessToken: config.metaCredentials.accessToken,
        header: '💸 Sell Crypto',
        body: 'Which currency would you like to receive?',
        buttons: [
          { id: 'currency_NGN', title: '🇳🇬 NGN — Naira' },
        ],
        footer: 'More currencies coming soon',
      })

      return {
        reply: '',
        newSession: {
          flow: 'WITHDRAW',
          step: 'AWAITING_CURRENCY',
          data: {},
        },
      }
    }

    // Twilio fallback
    return {
      reply:
        '💸 *Sell Crypto*\n\n' +
        'Which currency would you like to receive?\n\n' +
        '1. NGN (Nigerian Naira)\n\n' +
        '_Reply with 1_',
      newSession: { flow: 'WITHDRAW', step: 'AWAITING_CURRENCY_TEXT', data: {} },
    }
  }

  // ── AWAITING_CURRENCY — handle currency button reply ─────────────────────
  if (session.step === 'AWAITING_CURRENCY') {
    const currency = message.body === 'currency_NGN' ? 'NGN' : null
    if (!currency) {
      return {
        reply: 'Please tap the currency button above to continue.',
        newSession: session,
      }
    }
    return sendBankSelectionButtons(input, currency)
  }

  // Twilio fallback currency text
  if (session.step === 'AWAITING_CURRENCY_TEXT') {
    return sendBankSelectionButtons(input, 'NGN')
  }

  // ── AWAITING_BANK_CHOICE — handle Choose Existing / Add New ──────────────
  if (session.step === 'AWAITING_BANK_CHOICE') {
    const currency = (session.data as any).currency as string

    if (message.body === 'bank_add_new') {
      return {
        reply: '🏦 Let\'s add a new bank account.',
        newSession: { flow: 'ADD_BANK', step: null, data: { returnTo: 'WITHDRAW', currency } as any },
      }
    }

    if (message.body === 'bank_choose_existing') {
      return sendBankAccountList(input, currency)
    }

    return {
      reply: 'Please tap a button above to continue.',
      newSession: session,
    }
  }

  // Twilio fallback bank choice text
  if (session.step === 'AWAITING_BANK_CHOICE_TEXT') {
    const currency = (session.data as any).currency as string
    if (message.body === '1') return sendBankAccountList(input, currency)
    if (message.body === '2') {
      return {
        reply: '🏦 Let\'s add a new bank account.',
        newSession: { flow: 'ADD_BANK', step: null, data: { returnTo: 'WITHDRAW', currency } as any },
      }
    }
    return {
      reply: 'Please reply with 1 (existing) or 2 (add new).',
      newSession: session,
    }
  }

  // ── AWAITING_BANK_SELECT — handle list reply (bank account selected) ──────
  if (session.step === 'AWAITING_BANK_SELECT') {
    const currency = (session.data as any).currency as string
    const bankAccounts = (session.data as any).bankAccounts as Array<{
      id: string
      bankName: string
      accountNumber: string
      accountName: string
      bankCode: string
    }>

    const selectedIndex = parseInt(message.body.replace('bank_', ''), 10)
    const selectedBank = !isNaN(selectedIndex) ? bankAccounts[selectedIndex] : undefined

    if (!selectedBank) {
      return {
        reply: 'Please select a bank account from the list above.',
        newSession: session,
      }
    }

    return startCashoutPrompt(input, selectedBank, currency)
  }

  // Twilio fallback bank text select
  if (session.step === 'AWAITING_BANK_TEXT_SELECT') {
    const currency = (session.data as any).currency as string
    const bankAccounts = (session.data as any).bankAccounts as Array<{
      id: string
      bankName: string
      accountNumber: string
      accountName: string
      bankCode: string
    }>

    const selectedIndex = parseInt(message.body, 10) - 1
    const selectedBank = !isNaN(selectedIndex) ? bankAccounts[selectedIndex] : undefined

    if (!selectedBank) {
      return {
        reply: 'Please reply with a valid number.',
        newSession: session,
      }
    }

    return startCashoutPrompt(input, selectedBank, currency)
  }

  // ── AWAITING_PROCEED — user tapped Proceed button ────────────────────────
  if (session.step === 'AWAITING_PROCEED') {
    if (message.body === 'proceed_cashout') {
      const bank = (session.data as any).bank as {
        bankCode: string
        accountNumber: string
        accountName: string
      }

      return {
        reply: '💸 *How much would you like to sell?*\n\n_Reply with the amount e.g. 100_',
        newSession: {
          flow: 'CASHOUT',
          step: 'AWAITING_AMOUNT',
          data: {
            asset: '',
            bankCode: bank.bankCode,
            accountNumber: bank.accountNumber,
            accountName: bank.accountName,
          },
        },
      }
    }
    return {
      reply: 'Please tap Proceed above to continue.',
      newSession: session,
    }
  }

  // ── AWAITING_CASHOUT_FLOW ─────────────────────────────────────────────────
  if (session.step === 'AWAITING_CASHOUT_FLOW') {
    return {
      reply: '📱 Please complete your transaction in the secure screen above.',
      newSession: session,
    }
  }

  return {
    reply: 'Type /help for available commands.',
    newSession: { flow: null, step: null, data: {} },
  }
}

// ── Send bank selection buttons (Choose Existing / Add New) ──────────────────

async function sendBankSelectionButtons(
  input: HandlerInput,
  currency: string
): Promise<HandlerOutput> {
  const { message, config } = input

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.sendButtons({
      to: message.from,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      body: 'Do you want to choose an existing bank account or add a new one?',
      buttons: [
        { id: 'bank_choose_existing', title: 'Choose Existing' },
        { id: 'bank_add_new', title: 'Add New' },
      ],
    })

    return {
      reply: '',
      newSession: {
        flow: 'WITHDRAW',
        step: 'AWAITING_BANK_CHOICE',
        data: { currency } as any,
      },
    }
  }

  return {
    reply:
      '🏦 *Bank Account*\n\n' +
      'Do you want to use an existing bank account or add a new one?\n\n' +
      '1. Choose existing\n' +
      '2. Add new\n\n' +
      '_Reply with 1 or 2_',
    newSession: {
      flow: 'WITHDRAW',
      step: 'AWAITING_BANK_CHOICE_TEXT',
      data: { currency } as any,
    },
  }
}

// ── Send existing bank accounts as list message ───────────────────────────────

async function sendBankAccountList(
  input: HandlerInput,
  currency: string
): Promise<HandlerOutput> {
  const { message, config } = input

  let bankAccounts: Array<{
    id: string
    bankName: string
    accountNumber: string
    accountName: string
    bankCode: string
  }> = []

  try {
    bankAccounts = await zeuspay.getBankAccounts(message.from, config.partnerApiKey)
  } catch {}

  if (bankAccounts.length === 0) {
    return {
      reply:
        '🏦 You have no saved bank accounts.\n\n' +
        'Type /addbank to add one first.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.sendList({
      to: message.from,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      body: 'Select a bank account to receive your funds:',
      buttonText: 'View accounts',
      sections: [
        {
          title: 'Your bank accounts',
          rows: bankAccounts.slice(0, 10).map((acc, i) => ({
            id: `bank_${i}`,
            title: `${acc.bankName}`.slice(0, 24),
            description: `${acc.accountName} — ••••${acc.accountNumber.slice(-4)}`,
          })),
        },
      ],
      footer: 'Tap an account to select it',
    })

    return {
      reply: '',
      newSession: {
        flow: 'WITHDRAW',
        step: 'AWAITING_BANK_SELECT',
        data: { currency, bankAccounts: bankAccounts.slice(0, 10) } as any,
      },
    }
  }

  // Twilio fallback
  let reply = '🏦 *Select Bank Account*\n\n'
  bankAccounts.slice(0, 5).forEach((acc, i) => {
    reply += `${i + 1}. ${acc.bankName} — ••••${acc.accountNumber.slice(-4)}\n`
  })
  reply += '\n_Reply with a number_'

  return {
    reply,
    newSession: {
      flow: 'WITHDRAW',
      step: 'AWAITING_BANK_TEXT_SELECT',
      data: { currency, bankAccounts: bankAccounts.slice(0, 5) } as any,
    },
  }
}

// ── Show Proceed prompt after bank is selected ────────────────────────────────

async function startCashoutPrompt(
  input: HandlerInput,
  bank: { id: string; bankName: string; accountNumber: string; accountName: string; bankCode: string },
  currency: string
): Promise<HandlerOutput> {
  const { message, config } = input
  const redis = getRedisClient()

  await redis.set(
    `withdraw:bank:${message.from}`,
    JSON.stringify({ ...bank, currency }),
    'EX',
    600
  )

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.sendButtons({
      to: message.from,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      body:
        `To sell crypto for 🇳🇬 NGN, tap "Proceed" to enter ` +
        `the amount you want to sell.`,
      buttons: [
        { id: 'proceed_cashout', title: 'Proceed' },
      ],
      footer: `Sending to: ${bank.bankName} ••••${bank.accountNumber.slice(-4)}`,
    })

    return {
      reply: '',
      newSession: {
        flow: 'WITHDRAW',
        step: 'AWAITING_PROCEED',
        data: { currency, bank } as any,
      },
    }
  }

  // Twilio fallback — jump straight to cashout amount
  return {
    reply: 'How much would you like to sell? (e.g. 100)',
    newSession: {
      flow: 'CASHOUT',
      step: 'AWAITING_AMOUNT',
      data: {
        asset: '',
        bankCode: bank.bankCode,
        accountNumber: bank.accountNumber,
        accountName: bank.accountName,
      },
    },
  }
}
