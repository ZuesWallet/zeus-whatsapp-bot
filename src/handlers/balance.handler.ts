import { ZeusPayService } from '../services/zeuspay.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()

export async function balanceHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, config } = input

  await zeuspay.getOrCreateUser(message.from, config.partnerApiKey)
  const wallets = await zeuspay.getWallets(message.from, config.partnerApiKey)

  const nonZero = wallets.filter((w) => parseFloat(w.balance) > 0)

  if (nonZero.length === 0) {
    return {
      reply:
        '💼 Your wallet is empty. Send crypto to start.\n\n' +
        'Type *wallet* for deposit addresses.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  let reply = '💼 *Your Balance*\n\n'
  for (const w of nonZero) {
    reply += `${w.asset}: ${parseFloat(w.balance).toFixed(6)} (≈ ₦${parseFloat(w.ngnValue).toLocaleString()})\n`
  }
  reply += '\nType *cash out [amount]* to convert to naira.'

  return { reply, newSession: { flow: null, step: null, data: {} } }
}
