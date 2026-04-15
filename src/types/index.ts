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
  twilioCredentials: {
    accountSid: string
    authToken: string
    messagingServiceSid: string
  }
}

// Redis session state
export interface Session {
  flow: 'CASHOUT' | 'ADD_BANK' | 'SET_PIN' | null
  step: string | null
  data: {
    asset?: string
    amount?: string
    bankCode?: string
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
    pin?: string
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
  bankName: string
  accountNumber: string
  accountName: string
  isDefault: boolean
}

export interface ZeusPayUser {
  externalUserId: string
  zeuspayUserId: string
}
