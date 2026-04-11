import { ZeusPayService } from '../services/zeuspay.service'
import type { HandlerInput, HandlerOutput } from '../types'

const zeuspay = new ZeusPayService()

function statusEmoji(status: string): string {
  if (status === 'COMPLETED') return '✅'
  if (status === 'FAILED' || status === 'CANCELLED') return '❌'
  return '⏳'
}

export async function historyHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { message, config } = input

  await zeuspay.getOrCreateUser(message.from, config.partnerApiKey)
  const txs = await zeuspay.getTransactions(message.from, config.partnerApiKey, 5)

  if (txs.length === 0) {
    return {
      reply:
        '🕐 No transactions yet.\n\n' +
        'Type *cash out* to make your first withdrawal.',
      newSession: { flow: null, step: null, data: {} },
    }
  }

  let reply = '🕐 *Recent Transactions*\n\n'
  for (const tx of txs.slice(0, 5)) {
    const emoji = statusEmoji(tx.status)
    if (tx.type === 'DEPOSIT') {
      const ngnLabel = tx.ngnAmount ? ` (≈ ₦${parseFloat(tx.ngnAmount).toLocaleString()})` : ''
      reply += `↓ ${tx.asset} Deposit${ngnLabel} ${emoji}\n`
    } else {
      const ngnLabel = tx.ngnAmount ? `₦${parseFloat(tx.ngnAmount).toLocaleString()}` : tx.asset
      reply += `↑ Cash Out — ${ngnLabel} ${emoji}\n`
    }
  }

  reply += '\nType *cash out* to make a new withdrawal.'

  return { reply, newSession: { flow: null, step: null, data: {} } }
}
