import { ZeusPayService } from '../services/zeuspay.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()

const ASSET_LABELS: Record<string, string> = {
  USDT_ERC20: 'USDT (ERC-20)',
  USDT_TRC20: 'USDT (TRC-20)',
  USDC_ERC20: 'USDC (ERC-20)',
  USDC_BASE:  'USDC (Base)',
  BTC:        'BTC',
  ETH:        'ETH',
  BNB:        'BNB (BEP-20)',
}

export async function balanceHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, config } = input

  await zeuspay.getOrCreateUser(message.from, config.partnerApiKey)
  const wallets = await zeuspay.getWallets(message.from, config.partnerApiKey)

  const totalNgn = wallets.reduce((sum, w) => sum + parseFloat(w.ngnValue || '0'), 0)

  let reply = '💼 *Your Balance*\n\n'
  for (const w of wallets) {
    const label = ASSET_LABELS[w.asset] || w.asset
    const bal = parseFloat(w.balance)
    const ngn = parseFloat(w.ngnValue || '0')
    if (bal > 0) {
      reply += `*${label}:* ${bal.toFixed(6)} (≈ ₦${ngn.toLocaleString()})\n`
    } else {
      reply += `${label}: 0.000000\n`
    }
  }

  reply += `\n*Total: ≈ ₦${totalNgn.toLocaleString()}*`

  if (totalNgn > 0) {
    reply += '\n\nType *cash out [amount]* to convert to naira.'
  } else {
    reply += '\n\nSend crypto to start. Type *wallet* for deposit addresses.'
  }

  return { reply, newSession: { flow: null, step: null, data: {} } }
}
