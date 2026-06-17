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

export async function walletHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, config } = input

  await zeuspay.getOrCreateUser(message.from, config.partnerApiKey)
  const wallets = await zeuspay.getWallets(message.from, config.partnerApiKey)

  const header = '📥 *Deposit Addresses*\n_Tap and hold on an address below, then tap *Copy* to copy it._'

  const replies = wallets.map((w) => {
    const label = ASSET_LABELS[w.asset] || w.asset
    return `*${label}*\n${w.address}`
  })

  replies.push('⚠️ _Only send the matching asset to each address._')

  return { reply: header, replies, newSession: { flow: null, step: null, data: {} } }
}
