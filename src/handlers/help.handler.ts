import type { HandlerInput, HandlerOutput, WACommand } from '../types'

const commandMap: Record<WACommand, string> = {
  RATE:     '📊 *rate* — Today\'s USDT/NGN rate',
  BALANCE:  '💼 *balance* — Your crypto balance',
  WALLET:   '📥 *wallet* — Your deposit addresses',
  CASHOUT:  '💸 *cash out [amount]* — Convert to naira',
  HISTORY:  '🕐 *history* — Your last 5 transactions',
  ADD_BANK: '🏦 *add bank* — Add a bank account',
  HELP:     '',
}

export async function helpHandler(input: HandlerInput): Promise<HandlerOutput> {
  const { config } = input

  const commandLines = config.enabledCommands
    .filter((c) => c !== 'HELP' && commandMap[c])
    .map((c) => commandMap[c])
    .join('\n')

  const reply = config.welcomeMessage ||
    `👋 Welcome to *${config.botName}*!\n\n` +
    `Here's what I can do:\n\n` +
    `${commandLines}\n\n` +
    `_Powered by ZeusPay_ ⚡`

  return { reply, newSession: { flow: null, step: null, data: {} } }
}
