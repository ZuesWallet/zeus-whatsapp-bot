import type { Intent } from '../types'

export class IntentService {
  parse(text: string): Intent {
    const t = text.trim().toLowerCase()

    // PIN entry: exactly 6 digits, nothing else
    if (/^\d{6}$/.test(t)) {
      return { type: 'PIN_ENTRY', pin: t }
    }

    // Menu selection: single digit 1–9
    if (/^[1-9]$/.test(t)) {
      return { type: 'MENU_SELECT', option: t }
    }

    // Cancel / stop
    if (['cancel', 'stop', 'quit', 'exit', 'abort'].includes(t)) {
      return { type: 'CANCEL' }
    }

    // Help / menu / greeting
    if (
      ['help', 'menu', 'hi', 'hello', 'start', 'hey', '?'].includes(t) ||
      t.startsWith('hi ') ||
      t.startsWith('hello ')
    ) {
      return { type: 'HELP' }
    }

    // Rate
    if (
      t.includes('rate') ||
      t.includes('price') ||
      t.includes('how much') ||
      t === 'check rate' ||
      t === 'current rate'
    ) {
      return { type: 'RATE' }
    }

    // Balance
    if (
      t.includes('balance') ||
      t === 'bal' ||
      t.includes('my balance') ||
      t.includes('check balance') ||
      t.includes('how many')
    ) {
      return { type: 'BALANCE' }
    }

    // Wallet / deposit address
    if (
      t.includes('wallet') ||
      t.includes('deposit') ||
      t.includes('address') ||
      t.includes('send wallet') ||
      t.includes('receive') ||
      t === 'addr'
    ) {
      return { type: 'WALLET' }
    }

    // History
    if (
      t.includes('history') ||
      t.includes('transaction') ||
      t.includes('trades') ||
      t.includes('last trade') ||
      t.includes('my trade') ||
      t === 'hist'
    ) {
      return { type: 'HISTORY' }
    }

    // Add bank
    if (
      t.includes('add bank') ||
      t.includes('bank account') ||
      t.includes('add account') ||
      t.includes('new bank')
    ) {
      return { type: 'ADD_BANK' }
    }

    // Set PIN
    if (
      t.includes('set pin') ||
      t.includes('create pin') ||
      t.includes('new pin') ||
      t === 'pin'
    ) {
      return { type: 'SET_PIN' }
    }

    // Cashout — also try to extract amount and asset
    if (
      t.includes('cash out') ||
      t.includes('cashout') ||
      t.includes('cash-out') ||
      t.includes('sell') ||
      t.includes('withdraw') ||
      t.includes('convert')
    ) {
      const amountMatch = t.match(/(\d+(?:\.\d+)?)\s*(usdt|usdc|btc|eth|bnb)?/)
      const amount = amountMatch ? amountMatch[1] : undefined
      const assetRaw = amountMatch ? amountMatch[2]?.toUpperCase() : undefined

      const assetMap: Record<string, string> = {
        USDT: 'USDT_ERC20',
        USDC: 'USDC_ERC20',
        BTC: 'BTC',
        ETH: 'ETH',
        BNB: 'BNB',
      }
      const asset = assetRaw ? assetMap[assetRaw] : undefined

      return { type: 'CASHOUT', amount, asset }
    }

    return { type: 'UNKNOWN' }
  }
}
