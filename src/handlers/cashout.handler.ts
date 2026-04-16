import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import type { HandlerInput, HandlerOutput, ZeusPayEstimate, ZeusPayTransaction } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

export async function cashoutHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  // ── CANCEL from any step ──────────────────────────────────────────────────
  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cashout cancelled. Type *help* to see what I can do.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── STEP: AWAITING_AMOUNT (or first entry with no step) ───────────────────
  if (!session.step || session.step === 'AWAITING_AMOUNT') {
    const amount =
      intent.type === 'CASHOUT' && intent.amount
        ? intent.amount
        : session.step === 'AWAITING_AMOUNT'
        ? message.body.trim()
        : null

    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0) {
      return {
        reply:
          '💸 *Cash Out*\n\n' +
          'How much USDT would you like to cash out?\n\n' +
          '_Reply with just the amount e.g. *100*_\n\n' +
          'Type *cancel* to abort.',
        newSession: { flow: 'CASHOUT', step: 'AWAITING_AMOUNT', data: {} },
      }
    }

    const asset = (intent.type === 'CASHOUT' && intent.asset) || 'USDT_ERC20'

    let estimate: ZeusPayEstimate
    try {
      estimate = await zeuspay.getEstimate(asset, amount, config.partnerApiKey)
    } catch (err: any) {
      console.error('[cashout] getEstimate failed', {
        asset,
        amount,
        code: err?.code,
        message: err?.message,
        status: err?.response?.status,
        data: err?.response?.data,
      })
      return {
        reply: '⚠️ Could not get a rate estimate right now. Please try again shortly.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    let bankAccounts: Awaited<ReturnType<typeof zeuspay.getBankAccounts>> = []
    try {
      bankAccounts = await zeuspay.getBankAccounts(message.from, config.partnerApiKey)
    } catch {
      // Non-fatal — user can add bank during flow
    }

    const assetDisplay = asset.replace('_ERC20', '').replace('_TRC20', '').replace('_BASE', '')

    let reply = `📤 *Cashout Preview*\n\n`
    reply += `Selling: ${amount} ${assetDisplay}\n`
    reply += `Rate: 1 USDT = ₦${parseFloat(estimate.rateUsed).toLocaleString()}\n`
    reply += `Fee: ₦${parseFloat(estimate.feeAmountNgn).toLocaleString()}\n`
    reply += `*You receive: ₦${parseFloat(estimate.ngnAmount).toLocaleString()}*\n\n`

    if (bankAccounts.length > 0) {
      reply += `Where should we send your naira?\n\n`
      bankAccounts.slice(0, 3).forEach((acc, i) => {
        reply += `${i + 1}. ${acc.bankName} — ••••${acc.accountNumber.slice(-4)}\n`
      })
      reply += `${Math.min(bankAccounts.length, 3) + 1}. ➕ Add new bank account\n`
      reply += `\n_Reply with a number to select_`
    } else {
      reply += `You have no saved bank accounts.\n\nReply *add bank* to add one first, or type *cancel* to abort.`
    }

    return {
      reply,
      newSession: { flow: 'CASHOUT', step: 'AWAITING_BANK', data: { asset, amount, estimate } },
    }
  }

  // ── STEP: AWAITING_BANK ───────────────────────────────────────────────────
  if (session.step === 'AWAITING_BANK') {
    let bankAccounts: Awaited<ReturnType<typeof zeuspay.getBankAccounts>> = []
    try {
      bankAccounts = await zeuspay.getBankAccounts(message.from, config.partnerApiKey)
    } catch {
      // Continue with empty list — user will add new bank
    }

    const addNewIndex = (Math.min(bankAccounts.length, 3) + 1).toString()

    // User typed "add bank" explicitly, or selected the add-new option, or has no accounts
    const wantsToAddBank =
      intent.type === 'ADD_BANK' ||
      (intent.type === 'MENU_SELECT' && intent.option === addNewIndex) ||
      bankAccounts.length === 0

    if (wantsToAddBank) {
      return {
        reply:
          '🏦 *Add Bank Account*\n\n' +
          'What is the name of your bank?\n\n' +
          '_e.g. GTBank, Access Bank, Zenith, UBA_\n\n' +
          'Type *cancel* to abort.',
        newSession: { ...session, step: 'AWAITING_NEW_BANK_NAME' },
      }
    }

    if (intent.type !== 'MENU_SELECT') {
      return {
        reply: 'Please reply with a number to select your bank account.',
        newSession: session,
      }
    }

    const selectedIndex = parseInt(intent.option) - 1
    const selected = bankAccounts[selectedIndex]

    if (!selected) {
      return {
        reply: `Please reply with a number between 1 and ${Math.min(bankAccounts.length, 3) + 1}.`,
        newSession: session,
      }
    }

    const est = session.data.estimate!
    const reply =
      `✅ *Confirm Cashout*\n\n` +
      `₦${parseFloat(est.ngnAmount).toLocaleString()} → ${selected.bankName}\n` +
      `Account: ••••${selected.accountNumber.slice(-4)} (${selected.accountName})\n\n` +
      `Enter your *6-digit PIN* to confirm.\n` +
      `Type *cancel* to abort.`

    return {
      reply,
      newSession: {
        ...session,
        step: 'AWAITING_PIN',
        data: {
          ...session.data,
          selectedBankAccountId: selected.id,
          bankCode: selected.bankName,
          accountNumber: selected.accountNumber,
          accountName: selected.accountName,
        },
      },
    }
  }

  // ── STEP: AWAITING_NEW_BANK_NAME — user types their bank name ────────────
  if (session.step === 'AWAITING_NEW_BANK_NAME') {
    let banks: { code: string; name: string }[] = []
    try {
      banks = await zeuspay.getBanks(config.partnerApiKey)
    } catch {
      return {
        reply: '⚠️ Could not verify banks right now. Please try again.',
        newSession: session,
      }
    }

    const query = message.body.trim()
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '')
    const q = norm(query)
    const matches = banks.filter((b) => {
      const n = norm(b.name)
      return n.includes(q) || q.includes(n)
    })

    if (matches.length === 0) {
      return {
        reply:
          `❓ No bank found for *${query}*.\n\n` +
          `Please try again with a different spelling, or type *cancel* to abort.`,
        newSession: session,
      }
    }

    if (matches.length === 1) {
      return {
        reply:
          `✅ *${matches[0].name}*\n\n` +
          `Enter your *10-digit account number*:\n\n` +
          `Type *cancel* to abort.`,
        newSession: {
          ...session,
          step: 'AWAITING_NEW_BANK_ACCT',
          data: { ...session.data, bankCode: matches[0].code, bankName: matches[0].name },
        },
      }
    }

    const shortList = matches.slice(0, 3)
    let reply = `Found ${matches.length > 3 ? 'several' : matches.length} matches for *${query}*:\n\n`
    shortList.forEach((b, i) => { reply += `${i + 1}. ${b.name}\n` })
    reply += matches.length > 3
      ? '\nPlease be more specific, or reply with a number above.'
      : '\nReply with the number, or type *cancel*.'

    return {
      reply,
      newSession: {
        ...session,
        step: 'AWAITING_NEW_BANK_DISAMBIGUATE',
        data: { ...session.data, shortList: shortList.map((b) => ({ code: b.code, name: b.name })) },
      },
    }
  }

  // ── STEP: AWAITING_NEW_BANK_DISAMBIGUATE — pick from short list ───────────
  if (session.step === 'AWAITING_NEW_BANK_DISAMBIGUATE') {
    const shortList = (session.data.shortList ?? []) as { code: string; name: string }[]
    const num = parseInt(message.body.trim())

    if (isNaN(num) || num < 1 || num > shortList.length) {
      return {
        reply: `Please reply with a number (1–${shortList.length}), or type *cancel* to abort.`,
        newSession: session,
      }
    }

    const bank = shortList[num - 1]
    return {
      reply:
        `✅ *${bank.name}*\n\n` +
        `Enter your *10-digit account number*:\n\n` +
        `Type *cancel* to abort.`,
      newSession: {
        ...session,
        step: 'AWAITING_NEW_BANK_ACCT',
        data: { ...session.data, bankCode: bank.code, bankName: bank.name },
      },
    }
  }

  // ── STEP: AWAITING_NEW_BANK_ACCT — user enters account number ─────────────
  if (session.step === 'AWAITING_NEW_BANK_ACCT') {
    const accountNumber = message.body.trim().replace(/\s+/g, '')
    if (!/^\d{10}$/.test(accountNumber)) {
      return {
        reply: 'Account number must be exactly 10 digits. Try again or type *cancel*.',
        newSession: session,
      }
    }

    let resolvedName: string
    try {
      const resolved = await zeuspay.resolveBank(accountNumber, session.data.bankCode!, config.partnerApiKey)
      resolvedName = resolved.accountName
    } catch {
      return {
        reply: '⚠️ Could not verify that account number. Please check and try again.',
        newSession: session,
      }
    }

    const est = session.data.estimate!
    return {
      reply:
        `✅ *Confirm Cashout*\n\n` +
        `₦${parseFloat(est.ngnAmount).toLocaleString()} → ${resolvedName}\n` +
        `Bank: ${session.data.bankName}\n` +
        `Account: ••••${accountNumber.slice(-4)}\n\n` +
        `Enter your *6-digit PIN* to confirm.\n` +
        `Type *cancel* to abort.`,
      newSession: {
        ...session,
        step: 'AWAITING_PIN',
        data: { ...session.data, accountNumber, accountName: resolvedName },
      },
    }
  }

  // ── STEP: AWAITING_PIN ────────────────────────────────────────────────────
  if (session.step === 'AWAITING_PIN') {
    if (intent.type !== 'PIN_ENTRY') {
      return {
        reply: 'Please enter your 6-digit PIN to confirm, or type *cancel* to abort.',
        newSession: session,
      }
    }

    const { data } = session

    // First verify the PIN — get a short-lived token, then use it for the cashout
    let pinToken: string
    try {
      pinToken = await zeuspay.verifyPin(message.from, intent.pin!, config.partnerApiKey)
    } catch (err: any) {
      if (err.code === 'WRONG_PIN') {
        const remaining = err.details?.attemptsRemaining
        const hint = remaining !== undefined ? `${remaining} attempt(s) remaining.` : 'Please try again.'
        return {
          reply: `❌ Incorrect PIN. ${hint}\n\nEnter your PIN or type *cancel*.`,
          newSession: session,
        }
      }
      if (err.code === 'PIN_LOCKED') {
        return {
          reply: '🔒 Your PIN has been locked due to too many wrong attempts. Try again in 30 minutes.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      if (err.code === 'PIN_NOT_SET') {
        return {
          reply: '⚠️ You haven\'t set a PIN yet. Type *set pin* to create one first.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      return {
        reply: '⚠️ Could not verify PIN. Please try again.',
        newSession: session,
      }
    }

    let transaction: ZeusPayTransaction
    try {
      transaction = await zeuspay.cashout({
        phone: message.from,
        asset: data.asset!,
        cryptoAmount: data.estimate!.cryptoAmount,
        pinToken,
        bankCode: data.bankCode!,
        accountNumber: data.accountNumber!,
        accountName: data.accountName!,
        apiKey: config.partnerApiKey,
      })
    } catch (err: any) {
      if (err.code === 'INSUFFICIENT_BALANCE') {
        return {
          reply: '⚠️ Insufficient balance. Type *balance* to check your current balance.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      return {
        reply: '⚠️ Cashout could not be processed. Please try again shortly.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    void transaction // used for type-checking; reply is enough

    return {
      reply:
        `⏳ *Processing your cashout...*\n\n` +
        `We're sending ₦${parseFloat(data.estimate!.ngnAmount).toLocaleString()} ` +
        `to your account ending in ••••${data.accountNumber!.slice(-4)}.\n\n` +
        `This usually takes under 5 minutes.\n` +
        `We'll message you when it's done.`,
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // Fallback
  return {
    reply: 'Type *help* to see available commands.',
    newSession: { flow: null, step: null, data: {} },
  }
}
