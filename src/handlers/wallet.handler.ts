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

  let reply = '📥 *Deposit Addresses*\n\n'
  for (const w of wallets) {
    const label = ASSET_LABELS[w.asset] || w.asset
    reply += `*${label}*\n\`${w.address}\`\n\n`
  }
  reply += '⚠️ _Only send the matching asset to each address._'

  return { reply, newSession: { flow: null, step: null, data: {} } }
}
