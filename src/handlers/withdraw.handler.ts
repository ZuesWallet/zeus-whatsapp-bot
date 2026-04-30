import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import { metaService } from '../services/meta.service'
import { getRedisClient } from '../lib/redis'
import type { HandlerInput, HandlerOutput } from '../types'
import { addBankHandler } from './addBank.handler'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

type BankAccount = {
  id: string
  bankName: string
  accountNumber: string
  accountName: string
  bankCode: string
}

export async function withdrawHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cancelled. Type /help for options.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── ENTRY — no active step yet, show currency list ────────────────────────
  // Only matches when step is null/undefined — NOT when step === 'AWAITING_CURRENCY'
  if (!session.step) {
    return sendCurrencyList(input)
  }

  // ── AWAITING_CURRENCY — user selected from the currency list ─────────────
  if (session.step === 'AWAITING_CURRENCY') {
    // list_reply id will be e.g. "currency_NGN"
    const currency = message.body.startsWith('currency_')
      ? message.body.replace('currency_', '')
      : null

    if (!currency) {
      return {
        reply: 'Please tap *Select Currency* above and choose a currency.',
        newSession: session,
      }
    }

    return sendBankList(input, currency)
  }

  // Twilio fallback currency text
  if (session.step === 'AWAITING_CURRENCY_TEXT') {
    return sendBankList(input, 'NGN')
  }

  // ── AWAITING_BANK — user selected from the bank list ─────────────────────
  if (session.step === 'AWAITING_BANK') {
    const currency = (session.data as any).currency as string
    const bankAccounts = (session.data as any).bankAccounts as BankAccount[]

    if (message.body === 'bank_add_new') {
      return addBankHandler({
        ...input,
        session: { flow: 'ADD_BANK', step: null, data: { returnTo: 'WITHDRAW', currency } as any },
      })
    }

    const idx = parseInt(message.body.replace('bank_', ''), 10)
    const selectedBank = !isNaN(idx) ? bankAccounts[idx] : undefined

    if (!selectedBank) {
      return {
        reply: 'Please tap *View Accounts* above and select a bank account.',
        newSession: session,
      }
    }

    return sendProceedButton(input, selectedBank, currency)
  }

  // Twilio fallback bank text select
  if (session.step === 'AWAITING_BANK_TEXT_SELECT') {
    const currency = (session.data as any).currency as string
    const bankAccounts = (session.data as any).bankAccounts as BankAccount[]

    if (message.body === String(bankAccounts.length + 1)) {
      return addBankHandler({
        ...input,
        session: { flow: 'ADD_BANK', step: null, data: { returnTo: 'WITHDRAW', currency } as any },
      })
    }

    const idx = parseInt(message.body, 10) - 1
    const selectedBank = !isNaN(idx) ? bankAccounts[idx] : undefined

    if (!selectedBank) {
      return { reply: 'Please reply with a valid number.', newSession: session }
    }

    return sendProceedButton(input, selectedBank, currency)
  }

  // ── AWAITING_PROCEED — user tapped Proceed ────────────────────────────────
  if (session.step === 'AWAITING_PROCEED') {
    if (message.body === 'proceed_cashout') {
      const bank = (session.data as any).bank as BankAccount

      return {
        reply: '💸 *How much would you like to sell?*\n\n_Reply with the amount, e.g. 100_',
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
      reply: 'Please tap *Proceed* above to continue.',
      newSession: session,
    }
  }

  return {
    reply: 'Type /help for available commands.',
    newSession: { flow: null, step: null, data: {} },
  }
}

// ── Currency list ─────────────────────────────────────────────────────────────

async function sendCurrencyList(input: HandlerInput): Promise<HandlerOutput> {
  const { message, config } = input

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.sendList({
      to: message.from,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      header: '💸 Sell Crypto',
      body: 'Which currency would you like to receive?',
      buttonText: 'Select Currency',
      sections: [
        {
          title: 'Available Currencies',
          rows: [
            {
              id: 'currency_NGN',
              title: '🇳🇬 Nigerian Naira',
              description: 'NGN — Receive naira in your bank account',
            },
          ],
        },
      ],
      footer: 'More currencies coming soon',
    })

    return {
      reply: '',
      newSession: { flow: 'WITHDRAW', step: 'AWAITING_CURRENCY', data: {} },
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

// ── Bank account list (accounts + Add New as last row) ────────────────────────

async function sendBankList(input: HandlerInput, currency: string): Promise<HandlerOutput> {
  const { message, config } = input

  let bankAccounts: BankAccount[] = []
  try {
    bankAccounts = await zeuspay.getBankAccounts(message.from, config.partnerApiKey)
  } catch {}

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    const accountRows = bankAccounts.slice(0, 9).map((acc, i) => ({
      id: `bank_${i}`,
      title: acc.bankName.slice(0, 24),
      description: `${acc.accountName} — ••••${acc.accountNumber.slice(-4)}`,
    }))

    const rows = [
      ...accountRows,
      {
        id: 'bank_add_new',
        title: '➕ Add New Account',
        description: 'Link a new bank account',
      },
    ]

    await metaService.sendList({
      to: message.from,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      header: '🏦 Bank Account',
      body: `Where should we send your ${currency}?`,
      buttonText: 'View Accounts',
      sections: [{ title: 'Your bank accounts', rows }],
      footer: 'Tap an account to select it',
    })

    return {
      reply: '',
      newSession: {
        flow: 'WITHDRAW',
        step: 'AWAITING_BANK',
        data: { currency, bankAccounts: bankAccounts.slice(0, 9) } as any,
      },
    }
  }

  // Twilio fallback
  let reply = `🏦 *Select Bank Account*\n\nWhere should we send your ${currency}?\n\n`
  bankAccounts.slice(0, 5).forEach((acc, i) => {
    reply += `${i + 1}. ${acc.bankName} — ••••${acc.accountNumber.slice(-4)}\n`
  })
  reply += `${bankAccounts.slice(0, 5).length + 1}. ➕ Add new bank\n\n_Reply with a number_`

  return {
    reply,
    newSession: {
      flow: 'WITHDRAW',
      step: 'AWAITING_BANK_TEXT_SELECT',
      data: { currency, bankAccounts: bankAccounts.slice(0, 5) } as any,
    },
  }
}

// ── Proceed button after bank selected ───────────────────────────────────────

async function sendProceedButton(
  input: HandlerInput,
  bank: BankAccount,
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
      body: `Tap *Proceed* to enter the amount you want to sell.`,
      buttons: [{ id: 'proceed_cashout', title: 'Proceed' }],
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

  // Twilio fallback
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
