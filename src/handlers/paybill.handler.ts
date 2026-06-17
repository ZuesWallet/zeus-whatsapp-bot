import { ZeusPayService } from '../services/zeuspay.service'
import { IntentService } from '../services/intent.service'
import { metaService } from '../services/meta.service'
import { getRedisClient } from '../lib/redis'
import type { HandlerInput, HandlerOutput, ZeusPayBiller } from '../types'

const zeuspay = new ZeusPayService()
const intentSvc = new IntentService()

export async function paybillHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const intent = intentSvc.parse(message.body)

  if (intent.type === 'CANCEL') {
    return {
      reply: '❌ Cancelled. Type /help for options.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  // ── ENTRY — what bill type? ────────────────────────────────────────────
  if (!session.step) {
    if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
      await metaService.sendList({
        to: message.from,
        phoneNumberId: config.metaCredentials.phoneNumberId,
        accessToken: config.metaCredentials.accessToken,
        body: 'What would you like to pay?',
        buttonText: 'View options',
        sections: [
          {
            title: 'Bills',
            rows: [{ id: 'bill_electricity', title: '⚡ Electricity' }],
          },
        ],
      })

      return {
        reply: '',
        newSession: { flow: 'PAY_BILL', step: 'AWAITING_BILL_TYPE', data: {} },
      }
    }

    return {
      reply: '⚡ *Pay Bills*\n\n1. Electricity\n\n_Reply with 1_',
      newSession: { flow: 'PAY_BILL', step: 'AWAITING_BILL_TYPE_TEXT', data: {} },
    }
  }

  // ── AWAITING_BILL_TYPE — list reply received ──────────────────────────
  if (session.step === 'AWAITING_BILL_TYPE') {
    if (message.body !== 'bill_electricity') {
      return { reply: 'Please select an option from the list above.', newSession: session }
    }
    return sendDiscoList(input)
  }

  if (session.step === 'AWAITING_BILL_TYPE_TEXT') {
    if (message.body.trim() !== '1' && !/electric/i.test(message.body)) {
      return {
        reply: '⚡ *Pay Bills*\n\n1. Electricity\n\n_Reply with 1_',
        newSession: session,
      }
    }
    return sendDiscoList(input)
  }

  // ── AWAITING_DISCO — list reply with biller_code ───────────────────────
  if (session.step === 'AWAITING_DISCO') {
    const billers = (session.data.billers ?? []) as ZeusPayBiller[]
    const selected = billers.find((b) => b.billerCode === message.body)

    if (!selected) {
      return { reply: 'Please select a provider from the list above.', newSession: session }
    }

    return promptMeterType(input, selected.billerCode, selected.name)
  }

  // ── AWAITING_DISCO_TEXT — numbered reply (Twilio fallback) ─────────────
  if (session.step === 'AWAITING_DISCO_TEXT') {
    const billers = (session.data.billers ?? []) as ZeusPayBiller[]
    const idx = parseInt(message.body.trim(), 10) - 1
    const selected = billers[idx]

    if (!selected) {
      return { reply: `Please reply with a number between 1 and ${billers.length}.`, newSession: session }
    }

    return promptMeterType(input, selected.billerCode, selected.name)
  }

  // ── AWAITING_METER_TYPE — open the Flow ─────────────────────────────────
  if (session.step === 'AWAITING_METER_TYPE') {
    if (message.body !== 'meter_prepaid') {
      return { reply: 'Please tap Prepaid above to continue.', newSession: session }
    }
    return openPayBillFlow(input)
  }

  if (session.step === 'AWAITING_METER_TYPE_TEXT') {
    if (!/prepaid/i.test(message.body)) {
      return { reply: 'Please type "prepaid" to continue.', newSession: session }
    }
    return openPayBillFlow(input)
  }

  // ── AWAITING_PAYBILL_FLOW — nudge back to Flow ──────────────────────────
  if (session.step === 'AWAITING_PAYBILL_FLOW') {
    return {
      reply: '📱 Please complete your bill payment in the secure screen above.',
      newSession: session,
    }
  }

  return { reply: 'Type /help for available commands.', newSession: { flow: null, step: null, data: {} } }
}

// ── DISCO list ──────────────────────────────────────────────────────────────

async function sendDiscoList(input: HandlerInput): Promise<HandlerOutput> {
  const { message, config } = input

  let billers: ZeusPayBiller[]
  try {
    billers = await zeuspay.getElectricityBillers(config.partnerApiKey)
  } catch {
    return {
      reply: '⚠️ Could not load providers right now. Please try again shortly.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.sendList({
      to: message.from,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      body: 'Select your electricity provider:',
      buttonText: 'View providers',
      sections: [
        {
          title: 'Providers',
          rows: billers.slice(0, 10).map((b) => ({ id: b.billerCode, title: b.name.slice(0, 24) })),
        },
      ],
    })

    return {
      reply: '',
      newSession: { flow: 'PAY_BILL', step: 'AWAITING_DISCO', data: { billers } },
    }
  }

  let reply = '⚡ *Select Provider*\n\n'
  billers.slice(0, 10).forEach((b, i) => { reply += `${i + 1}. ${b.name}\n` })
  reply += '\n_Reply with a number_'

  return {
    reply,
    newSession: { flow: 'PAY_BILL', step: 'AWAITING_DISCO_TEXT', data: { billers } },
  }
}

// ── Prepaid/postpaid prompt ───────────────────────────────────────────────────

async function promptMeterType(
  input: HandlerInput,
  billerCode: string,
  billerName: string
): Promise<HandlerOutput> {
  const { message, config } = input

  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.sendButtons({
      to: message.from,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      body: `Paying ${billerName}. Select your meter type:`,
      buttons: [{ id: 'meter_prepaid', title: 'Prepaid' }],
    })

    return {
      reply: '',
      newSession: { flow: 'PAY_BILL', step: 'AWAITING_METER_TYPE', data: { billerCode, billerName } },
    }
  }

  return {
    reply: `${billerName} selected. Type "prepaid" to continue.`,
    newSession: { flow: 'PAY_BILL', step: 'AWAITING_METER_TYPE_TEXT', data: { billerCode, billerName } },
  }
}

// ── Open the Pay Bill Flow ───────────────────────────────────────────────────

async function openPayBillFlow(input: HandlerInput): Promise<HandlerOutput> {
  const { message, session, config } = input
  const { billerCode, billerName } = session.data

  let prepaidItem: { itemCode: string }
  try {
    prepaidItem = await zeuspay.getPrepaidItem(billerCode!, config.partnerApiKey)
  } catch {
    return {
      reply: '⚠️ This provider does not currently support prepaid payments.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  if (config.bspType !== 'META_CLOUD' || !config.metaCredentials) {
    return {
      reply: '⚠️ Bill payments require the secure WhatsApp Flow screen, which is not available on this number yet.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  const flowToken = `paybill_${message.from}_${Date.now()}`
  const redis = getRedisClient()

  await redis.set(
    `flow:paybill:${flowToken}`,
    JSON.stringify({
      phone: message.from,
      partnerId: config.partnerId,
      partnerApiKey: config.partnerApiKey,
      billerCode,
      billerName,
      itemCode: prepaidItem.itemCode,
      // TODO: let the user pick which asset to pay with, same as cashout — defaulting
      // to USDT_ERC20 until asset selection is added to this flow.
      asset: 'USDT_ERC20',
    }),
    'EX', 600
  )

  await metaService.sendFlow({
    to: message.from,
    phoneNumberId: config.metaCredentials.phoneNumberId,
    accessToken: config.metaCredentials.accessToken,
    flowId: config.metaCredentials.paybillFlowId ?? process.env.META_PAYBILL_FLOW_ID ?? '',
    flowCta: 'Pay Bill',
    screenId: 'ENTER_METER',
    flowData: { biller_name: billerName!, error_message: '' },
    flowToken,
  })

  return {
    reply: '',
    newSession: { flow: 'PAY_BILL', step: 'AWAITING_PAYBILL_FLOW', data: { flowToken } as any },
  }
}
