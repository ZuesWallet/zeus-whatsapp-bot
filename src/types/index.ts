export type WACommand =
  | 'RATE'
  | 'BALANCE'
  | 'WALLET'
  | 'CASHOUT'
  | 'HISTORY'
  | 'HELP'
  | 'ADD_BANK'
  | 'SET_PIN'

// Raw inbound message — normalised from Twilio's format
export interface InboundMessage {
  from: string       // User's number: +2348012345678
  to: string         // Partner's bot number: +2348XXXXXXXXX
  body: string       // Raw message text
  messageId: string  // Twilio MessageSid — for deduplication
  timestamp: number  // Unix ms
}

// Partner config resolved from routing lookup
export interface PartnerConfig {
  partnerId: string
  partnerApiKey: string  // pk_live_xxx — used for ZeusPay API calls
  botName: string
  welcomeMessage: string | null
  fallbackMessage: string | null
  fallbackWebhook: string | null
  enabledCommands: WACommand[]
  notificationsEnabled: boolean
  bspType: 'TWILIO' | 'DIALOG360' | 'META_CLOUD'
  whatsappNumber: string  // bot's display phone number e.g. +2348012345678
  twilioCredentials: {
    accountSid: string
    authToken: string
    messagingServiceSid: string
  }
  metaCredentials?: {
    accessToken: string
    phoneNumberId: string  // Meta's internal phone number ID
    wabaId: string
  }
}

// Redis session state
export interface Session {
  flow: 'CASHOUT' | 'ADD_BANK' | 'SET_PIN' | 'CHANGE_PIN' | 'FORGOT_PIN' | null
  step: string | null
  data: {
    asset?: string
    amount?: string
    bankCode?: string
    bankName?: string
    accountNumber?: string
    accountName?: string
    selectedBankAccountId?: string
    estimate?: {
      ngnAmount: string
      rateUsed: string
      feeAmountNgn: string
      cryptoAmount: string
    }
    transactionId?: string
    shortList?: { code: string; name: string }[]
    pin?: string
    currentPin?: string
    newPin?: string
  }
}

// Parsed intent from message text
export type Intent =
  | { type: 'RATE' }
  | { type: 'BALANCE' }
  | { type: 'WALLET' }
  | { type: 'HISTORY' }
  | { type: 'CASHOUT'; amount?: string; asset?: string }
  | { type: 'ADD_BANK' }
  | { type: 'SET_PIN' }
  | { type: 'CHANGE_PIN' }
  | { type: 'FORGOT_PIN' }
  | { type: 'HELP' }
  | { type: 'CANCEL' }
  | { type: 'MENU_SELECT'; option: string }
  | { type: 'PIN_ENTRY'; pin: string }
  | { type: 'UNKNOWN' }

// Handler input
export interface HandlerInput {
  message: InboundMessage
  session: Session
  config: PartnerConfig
}

// Handler output
export interface HandlerOutput {
  reply: string
  newSession?: Session | null
}

// ZeusPay API response shapes
export interface ZeusPayRate {
  asset: string
  fiat: string
  marketRate: string
  effectiveRate: string
  spread: { floor: string; markup: string; total: string }
  lastUpdated: string
}

export interface ZeusPayWallet {
  asset: string
  network: string
  address: string
  balance: string
  pendingBalance: string
  usdValue: string
  ngnValue: string
}

export interface ZeusPayTransaction {
  id: string
  type: 'DEPOSIT' | 'CASHOUT'
  asset: string
  cryptoAmount: string
  ngnAmount: string | null
  status: string
  createdAt: string
}

export interface ZeusPayEstimate {
  cryptoAmount: string
  usdAmount: string
  rateUsed: string
  feeAmountNgn: string
  ngnAmount: string
  estimatedMinutes: number
}

export interface ZeusPayBankAccount {
  id: string
  bankCode: string
  bankName: string
  accountNumber: string
  accountName: string
  isDefault: boolean
}

export interface ZeusPayUser {
  externalUserId: string
  zeuspayUserId: string
}

export interface PreparedCashout {
  transactionId: string
  flowData: {
    crypto_amount: string
    asset: string
    ngn_amount: string
    fee: string
    rate: string
    bank_name: string
    account_last4: string
    account_name: string
    transaction_id: string
    error_message: string
    has_error: string
  }
  expiresAt: string
}
