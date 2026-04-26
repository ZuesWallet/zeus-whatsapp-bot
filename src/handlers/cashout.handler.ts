import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import { metaService } from '../services/meta.service'
import { getRedisClient } from '../lib/redis'
import { matchBanks } from '../lib/bankMatch'
import type { HandlerInput, HandlerOutput, ZeusPayEstimate, ZeusPayTransaction, PreparedCashout } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

// ── Flow helper ───────────────────────────────────────────────────────────────

/**
 * Prepares a cashout transaction and sends a WhatsApp Flow message so the user
 * can enter their PIN in the secure native UI instead of typing it in chat.
 *
 * Called from two places:
 *  - After user selects an existing bank account (AWAITING_BANK)
 *  - After user enters and resolves a new bank account (AWAITING_NEW_BANK_ACCT)
 *
 * Falls back to text PIN if the partner is on Twilio or if the Flow send fails.
 */
async function openCashoutFlow(params: {
  message: HandlerInput['message']
  session: HandlerInput['session']
  config: HandlerInput['config']
  bankCode: string
  accountNumber: string
  accountName: string
}): Promise<HandlerOutput> {
  const { message, session, config, bankCode, accountNumber, accountName } = params

  // 1 — Prepare transaction: locks rate, creates PENDING record
  let prepared: PreparedCashout
  try {
    prepared = await zeuspay.prepareCashout({
      phone: message.from,
      asset: session.data.asset!,
      cryptoAmount: session.data.estimate!.cryptoAmount,
      bankCode,
      accountNumber,
      accountName,
      apiKey: config.partnerApiKey,
    })
  } catch (err: any) {
    console.error('[cashout] prepareCashout failed', { code: err.code, message: err.message, details: err.details })
    if (err.code === 'INSUFFICIENT_BALANCE') {
      return {
        reply: '⚠️ Insufficient balance. Type *balance* to check your current balance.',
        newSession: { flow: null, step: null, data: {} },
      }
    }
    if (err.code === 'BELOW_MINIMUM') {
      return {
        reply: `⚠️ Amount too small. ${err.message || 'Minimum cashout is $1.'}`,
        newSession: { flow: null, step: null, data: {} },
      }
    }
    if (err.code === 'VOLUME_LIMIT_EXCEEDED') {
      return {
        reply: '⚠️ Cashout limit reached for today. Please try again tomorrow.',
        newSession: { flow: null, step: null, data: {} },
      }
    }
    if (err.code === 'WALLET_NOT_FOUND') {
      return {
        reply: '⚠️ No wallet found for that asset. Type *wallet* to see your deposit addresses.',
        newSession: { flow: null, step: null, data: {} },
      }
    }
    if (err.code === 'VALIDATION_ERROR') {
      return {
        reply: `⚠️ Invalid request: ${err.message || 'please check your details and try again.'}`,
        newSession: { flow: null, step: null, data: {} },
      }
    }
    return {
      reply: '⚠️ Could not prepare your cashout. Please try again shortly.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // 2 — Send Flow message (data_exchange mode — backend serves screen data on INIT)
  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    try {
      const flowToken = `cashout_${prepared.transactionId}`
      const ttlSeconds = Math.max(
        Math.floor((new Date(prepared.expiresAt).getTime() - Date.now()) / 1000),
        60
      )
      const assetDisplay = String(session.data.asset ?? '')
        .replace('_ERC20', '')
        .replace('_TRC20', '')
        .replace('_BASE', '')

      const fmtNum = (v: unknown) =>
        parseFloat(String(v ?? '0')).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

      const flowData: Record<string, unknown> = {
        // Pre-formatted fields — used by older deployed flow versions
        selling_text: `Selling: ${prepared.cryptoAmount} ${assetDisplay}`,
        receive_text: `You receive: ₦${fmtNum(prepared.ngnAmount)}`,
        fee_text: `Fee: ₦${fmtNum(prepared.feeAmount)}`,
        rate_text: `Rate: 1 ${assetDisplay} = ₦${fmtNum(prepared.rateUsed)}`,
        bank_text: `${prepared.bankName} — ••••${prepared.accountLast4}`,
        // Individual fields — used by new flow JSON (cashout_confirmation.json)
        crypto_amount: String(prepared.cryptoAmount ?? ''),
        asset: assetDisplay,
        ngn_amount: fmtNum(prepared.ngnAmount),
        fee: fmtNum(prepared.feeAmount),
        rate: fmtNum(prepared.rateUsed),
        bank_name: String(prepared.bankName ?? ''),
        account_last4: String(prepared.accountLast4 ?? ''),
        // Common to both
        account_name: String(prepared.accountName ?? ''),
        transaction_id: String(prepared.transactionId ?? ''),
        has_error: false,
        error_message: '',
      }

      if (!flowData.transaction_id) {
        console.error('[openCashoutFlow] transaction_id is empty — aborting Flow send')
        throw new Error('transaction_id missing from prepared cashout')
      }

      console.log('[openCashoutFlow] flowData to inject:', JSON.stringify(flowData, null, 2))

      const redis = getRedisClient()
      await redis.set(
        `flow:init:${flowToken}`,
        JSON.stringify(flowData),
        'EX',
        ttlSeconds
      )

      await metaService.sendFlow({
        to: message.from,
        phoneNumberId: config.metaCredentials.phoneNumberId,
        accessToken: config.metaCredentials.accessToken,
        flowId: process.env.META_FLOW_ID!,
        flowCta: 'Confirm Cashout',
        screenId: 'CONFIRM_CASHOUT',
        flowData,
        flowToken,
      })

      return {
        reply: '',
        newSession: {
          flow: 'CASHOUT',
          step: 'AWAITING_FLOW_SENT',
          data: {
            ...session.data,
            transactionId: prepared.transactionId,
            bankCode,
            accountNumber,
            accountName,
          },
        },
      }
    } catch (err) {
      console.error('[cashout] sendFlow failed — falling back to text PIN', err)
      // Fall through to text-PIN fallback
    }
  }

  // Fallback: Twilio partners or Flow send failure → text PIN
  const est = session.data.estimate!
  return {
    reply:
      `✅ *Confirm Cashout*\n\n` +
      `₦${parseFloat(est.ngnAmount).toLocaleString()} → ${accountName}\n` +
      `Account: ••••${accountNumber.slice(-4)}\n\n` +
      `Enter your *6-digit PIN* to confirm.\n` +
      `Type *cancel* to abort.`,
    newSession: {
      ...session,
      step: 'AWAITING_PIN',
      data: {
        ...session.data,
        bankCode,
        accountNumber,
        accountName,
      },
    },
  }
}

// ── Main handler ──────────────────────────────────────────────────────────────

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
    // Enforce PIN before cashout can begin
    if (!session.step) {
      let pinSet = false
      try {
        pinSet = await zeuspay.hasPinSet(message.from, config.partnerApiKey)
      } catch {
        // If status check fails, let the flow continue — PIN will be required at confirm step anyway
        pinSet = true
      }
      if (!pinSet) {
        return {
          reply:
            '🔐 *PIN Required*\n\n' +
            'You need to set a transaction PIN before you can cash out.\n\n' +
            'Type *set pin* to create your PIN, then try again.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
    }

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
          'How much crypto would you like to cash out?\n\n' +
          '_Reply with just the amount, e.g. *100* (we\'ll use the asset you have balance in)_\n\n' +
          '_You can also specify: *100 USDT*, *0.001 BTC*, *1 ETH*_\n\n' +
          'Type *cancel* to abort.',
        newSession: { flow: 'CASHOUT', step: 'AWAITING_AMOUNT', data: {} },
      }
    }

    // Determine asset: use intent asset as a hint, but always verify balance.
    // If the hinted asset has zero balance, find the correct variant the user holds.
    let asset = (intent.type === 'CASHOUT' && intent.asset) || ''

    let wallets: Awaited<ReturnType<typeof zeuspay.getWallets>> = []
    try {
      wallets = await zeuspay.getWallets(message.from, config.partnerApiKey)
    } catch {
      // If fetch fails and intent gave us an asset, proceed (will fail at prepare step)
    }

    if (wallets.length > 0) {
      const hasEnough = (a: string) => {
        const w = wallets.find((w) => w.asset === a)
        return !!w && parseFloat(w.balance) >= parseFloat(amount)
      }

      if (!asset || !hasEnough(asset)) {
        // Strip network suffix to find variants of the same base asset
        const baseAsset = asset.replace(/_ERC20$|_TRC20$|_BASE$/, '')
        const withBalance = wallets
          .filter((w) => parseFloat(w.balance) >= parseFloat(amount))
          .sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance))

        // Prefer same base asset (e.g. user said "USDC", find USDC_BASE)
        const sameBase = baseAsset
          ? withBalance.filter((w) => w.asset.replace(/_ERC20$|_TRC20$|_BASE$/, '') === baseAsset)
          : []
        const candidates = sameBase.length > 0 ? sameBase : withBalance

        if (candidates.length === 0) {
          const best = wallets.sort((a, b) => parseFloat(b.balance) - parseFloat(a.balance))[0]
          return {
            reply:
              `⚠️ Insufficient balance.\n\n` +
              (best
                ? `Your ${best.asset.replace('_ERC20','').replace('_TRC20','').replace('_BASE','')} balance is ${parseFloat(best.balance).toFixed(6)}.`
                : `You have no funded wallets.`),
            newSession: { flow: null, step: null, data: {} },
          }
        }
        asset = candidates[0].asset
      }
    } else if (!asset) {
      asset = 'USDT_ERC20' // fallback if wallet fetch failed and no intent asset
    }

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
    reply += `Rate: 1 ${assetDisplay} = ₦${parseFloat(estimate.rateUsed).toLocaleString()}\n`
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

    return await openCashoutFlow({
      message,
      session,
      config,
      bankCode: selected.bankCode,
      accountNumber: selected.accountNumber,
      accountName: selected.accountName,
    })
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
    const matches = matchBanks(query, banks)

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

    return await openCashoutFlow({
      message,
      session,
      config,
      bankCode: session.data.bankCode!,
      accountNumber,
      accountName: resolvedName,
    })
  }

  // ── STEP: AWAITING_FLOW_SENT ───────────────────────────────────────────────
  // Flow message sent — user is completing PIN entry in the native Flow UI.
  // If they text us while the Flow is open, nudge them back to it.
  if (session.step === 'AWAITING_FLOW_SENT') {
    return {
      reply:
        '📱 Please complete your cashout in the secure confirmation screen.\n\n' +
        'If it has closed or expired, type *cash out* to start again.',
      newSession: session,
    }
  }

  // ── STEP: AWAITING_PIN (fallback for Twilio or Flow send failure) ─────────
  if (session.step === 'AWAITING_PIN') {
    if (intent.type !== 'PIN_ENTRY') {
      return {
        reply: 'Please enter your 6-digit PIN to confirm, or type *cancel* to abort.',
        newSession: session,
      }
    }

    const { data } = session

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
      console.error('[cashout] cashout failed', { code: err.code, message: err.message })
      if (err.code === 'INSUFFICIENT_BALANCE') {
        return {
          reply: '⚠️ Insufficient balance. Type *balance* to check your current balance.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      if (err.code === 'BELOW_MINIMUM') {
        return {
          reply: `⚠️ Amount too small. ${err.message || 'Minimum cashout is $1.'}`,
          newSession: { flow: null, step: null, data: {} },
        }
      }
      if (err.code === 'INVALID_PIN_TOKEN') {
        return {
          reply: '⏱️ Your PIN confirmation expired. Type *cash out* to start again.',
          newSession: { flow: null, step: null, data: {} },
        }
      }
      return {
        reply: '⚠️ Cashout could not be processed. Please try again shortly.',
        newSession: { flow: null, step: null, data: {} },
      }
    }

    void transaction

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
