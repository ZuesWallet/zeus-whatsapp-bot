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

    // Forgot PIN / reset PIN
    if (
      t.includes('forgot pin') ||
      t.includes('forget pin') ||
      t.includes('reset pin') ||
      t.includes('lost pin') ||
      t.includes('recover pin')
    ) {
      return { type: 'FORGOT_PIN' }
    }

    // Change PIN (knows current PIN)
    if (
      t.includes('change pin') ||
      t.includes('update pin') ||
      t.includes('change my pin')
    ) {
      return { type: 'CHANGE_PIN' }
    }

    // Set PIN (first time)
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
      const amountMatch = t.match(/(\d+(?:\.\d+)?)\s*(usdt|usdc|btc|eth|bnb)?\s*(erc.?20|trc.?20|base|bep.?20)?/)
      const amount = amountMatch ? amountMatch[1] : undefined
      const assetRaw = amountMatch ? amountMatch[2]?.toUpperCase() : undefined
      const networkRaw = amountMatch ? amountMatch[3]?.toLowerCase() : undefined

      let networkSuffix = ''
      if (networkRaw) {
        if (/trc/i.test(networkRaw)) networkSuffix = '_TRC20'
        else if (/base/i.test(networkRaw)) networkSuffix = '_BASE'
        else if (/erc/i.test(networkRaw)) networkSuffix = '_ERC20'
        // bep20 → BNB has no suffix variant
      }

      const assetMap: Record<string, string> = {
        USDT: 'USDT_ERC20',
        USDT_ERC20: 'USDT_ERC20',
        USDT_TRC20: 'USDT_TRC20',
        USDC: 'USDC_ERC20',
        USDC_ERC20: 'USDC_ERC20',
        USDC_BASE: 'USDC_BASE',
        BTC: 'BTC',
        ETH: 'ETH',
        ETH_ERC20: 'ETH',
        BNB: 'BNB',
        BNB_BEP20: 'BNB',
      }
      const assetKey = assetRaw ? `${assetRaw}${networkSuffix}` : undefined
      const asset = assetKey ? assetMap[assetKey] : undefined

      return { type: 'CASHOUT', amount, asset }
    }

    return { type: 'UNKNOWN' }
  }
}
