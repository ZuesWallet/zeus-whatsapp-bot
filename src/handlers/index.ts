import axios from 'axios'
import { IntentService } from '../services/intent.service'
import { helpHandler } from './help.handler'
import { rateHandler } from './rate.handler'
import { balanceHandler } from './balance.handler'
import { walletHandler } from './wallet.handler'
import { historyHandler } from './history.handler'
import { cashoutHandler } from './cashout.handler'
import { addBankHandler } from './addBank.handler'
import type { InboundMessage, Session, PartnerConfig, HandlerOutput, WACommand } from '../types'

const intentSvc = new IntentService()

export async function dispatch(
  message: InboundMessage,
  session: Session,
  config: PartnerConfig
): Promise<HandlerOutput> {
  const input = { message, session, config }
  const intent = intentSvc.parse(message.body)

  // Active flow — route to flow handler regardless of intent (CANCEL handled inside)
  if (session.flow === 'CASHOUT') {
    return cashoutHandler(input)
  }

  if (session.flow === 'ADD_BANK') {
    return addBankHandler(input)
  }

  // No active flow — check if command is enabled
  const commandToFeature: Record<string, WACommand> = {
    RATE:     'RATE',
    BALANCE:  'BALANCE',
    WALLET:   'WALLET',
    CASHOUT:  'CASHOUT',
    HISTORY:  'HISTORY',
    ADD_BANK: 'ADD_BANK',
    HELP:     'HELP',
  }

  const requiredFeature = commandToFeature[intent.type]
  if (requiredFeature && requiredFeature !== 'HELP' && !config.enabledCommands.includes(requiredFeature)) {
    return {
      reply: `That command is not available. Type *help* to see what's available.`,
      newSession: session,
    }
  }

  switch (intent.type) {
    case 'RATE':        return rateHandler(input)
    case 'BALANCE':     return balanceHandler(input)
    case 'WALLET':      return walletHandler(input)
    case 'HISTORY':     return historyHandler(input)
    case 'CASHOUT':     return cashoutHandler(input)
    case 'ADD_BANK':    return addBankHandler(input)
    case 'HELP':
    case 'MENU_SELECT': return helpHandler(input)
    case 'CANCEL':
      return {
        reply: 'Nothing to cancel. Type *help* to see available commands.',
        newSession: session,
      }
    case 'PIN_ENTRY':
      return {
        reply: 'Nothing to confirm right now. Type *help* to see available commands.',
        newSession: session,
      }
    case 'UNKNOWN':
    default: {
      // Forward to fallback webhook if configured
      if (config.fallbackWebhook) {
        try {
          await axios.post(
            config.fallbackWebhook,
            {
              from: message.from,
              body: message.body,
              timestamp: message.timestamp,
              partnerId: config.partnerId,
            },
            { timeout: 5000 }
          )
          return { reply: '' } // Partner's system handles the reply
        } catch {
          // Webhook failed — fall through to default message
        }
      }

      return {
        reply: config.fallbackMessage || `I didn't understand that. Type *help* to see available commands.`,
        newSession: session,
      }
    }
  }
}
