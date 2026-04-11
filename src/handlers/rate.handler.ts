import { ZeusPayService } from '../services/zeuspay.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()

export async function rateHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { config } = input

  try {
    const rate = await zeuspay.getRate(config.partnerApiKey)

    const updatedAt = new Date(rate.lastUpdated)
    const minutesAgo = Math.floor((Date.now() - updatedAt.getTime()) / 60000)
    const ageLabel = minutesAgo < 1 ? 'just now' : `${minutesAgo}m ago`

    const reply =
      `📊 *Live Rate*\n\n` +
      `1 USDT = ₦${parseFloat(rate.effectiveRate).toLocaleString()}\n` +
      `Updated ${ageLabel}\n\n` +
      `Type *cash out [amount]* to sell now.`

    return { reply, newSession: { flow: null, step: null, data: {} } }
  } catch {
    return {
      reply: '⚠️ Rates are temporarily unavailable. Please try again shortly.',
      newSession: { flow: null, step: null, data: {} },
    }
  }
}
