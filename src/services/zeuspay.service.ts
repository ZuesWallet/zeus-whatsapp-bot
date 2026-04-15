import axios, { AxiosInstance, AxiosError } from 'axios'
import type {
  ZeusPayUser, ZeusPayWallet, ZeusPayRate, ZeusPayEstimate,
  ZeusPayTransaction, ZeusPayBankAccount,
} from '../types'

class ZeusPayError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'ZeusPayError'
  }
}

export class ZeusPayService {
  private client(apiKey: string): AxiosInstance {
    return axios.create({
      baseURL: process.env.ZEUSPAY_API_URL || 'http://localhost:3000',
      timeout: 15000,
      headers: {
        'X-ZeusPay-Key': apiKey,
        'Content-Type': 'application/json',
      },
    })
  }

  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn()
    } catch (err) {
      const axiosErr = err as AxiosError
      // Retry once on network/server errors only
      if (!axiosErr.response || axiosErr.response.status >= 500) {
        try {
          return await fn()
        } catch (retryErr) {
          throw this.normalise(retryErr as AxiosError)
        }
      }
      throw this.normalise(axiosErr)
    }
  }

  private normalise(err: AxiosError): ZeusPayError {
    type ErrBody = { code?: string; message?: string; details?: Record<string, unknown> }
    if (err.response) {
      const body = err.response.data as ErrBody
      return new ZeusPayError(
        body?.code || 'ZEUSPAY_ERROR',
        body?.message || 'ZeusPay API error',
        body?.details
      )
    }
    return new ZeusPayError('NETWORK_ERROR', err.message || 'Network error')
  }

  async getOrCreateUser(phone: string, apiKey: string): Promise<ZeusPayUser> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).post('/api/v1/partner/users', {
        externalUserId: phone,
      })
      return res.data.data as ZeusPayUser
    })
  }

  async getWallets(phone: string, apiKey: string): Promise<ZeusPayWallet[]> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).get(`/api/v1/partner/users/${encodeURIComponent(phone)}/wallets`)
      return res.data.data as ZeusPayWallet[]
    })
  }

  async getRate(apiKey: string): Promise<ZeusPayRate> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).get('/api/v1/partner/rates')
      return res.data.data as ZeusPayRate
    })
  }

  async getEstimate(asset: string, amount: string, apiKey: string): Promise<ZeusPayEstimate> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).get('/api/v1/partner/cashout/estimate', {
        params: { asset, amount },
      })
      return res.data.data as ZeusPayEstimate
    })
  }

  async getTransactions(phone: string, apiKey: string, limit = 5): Promise<ZeusPayTransaction[]> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).get(
        `/api/v1/partner/users/${encodeURIComponent(phone)}/transactions`,
        { params: { limit } }
      )
      return res.data.data as ZeusPayTransaction[]
    })
  }

  async setPin(phone: string, pin: string, apiKey: string): Promise<void> {
    return this.withRetry(async () => {
      await this.client(apiKey).post(
        `/api/v1/partner/users/${encodeURIComponent(phone)}/pin/set`,
        { pin }
      )
    })
  }

  async changePin(phone: string, currentPin: string, newPin: string, apiKey: string): Promise<void> {
    return this.withRetry(async () => {
      await this.client(apiKey).post(
        `/api/v1/partner/users/${encodeURIComponent(phone)}/pin/change`,
        { currentPin, newPin }
      )
    })
  }

  async resetPin(phone: string, newPin: string, apiKey: string): Promise<void> {
    return this.withRetry(async () => {
      await this.client(apiKey).post(
        `/api/v1/partner/users/${encodeURIComponent(phone)}/pin/reset`,
        { newPin }
      )
    })
  }

  async verifyPin(phone: string, pin: string, apiKey: string): Promise<string> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).post(
        `/api/v1/partner/users/${encodeURIComponent(phone)}/pin/verify`,
        { pin }
      )
      return (res.data.data as { pinToken: string }).pinToken
    })
  }

  async cashout(params: {
    phone: string
    asset: string
    cryptoAmount: string
    pinToken: string
    bankCode: string
    accountNumber: string
    accountName: string
    apiKey: string
  }): Promise<ZeusPayTransaction> {
    return this.withRetry(async () => {
      const res = await this.client(params.apiKey).post(
        '/api/v1/partner/cashout',
        {
          externalUserId: params.phone,
          asset: params.asset,
          cryptoAmount: params.cryptoAmount,
          pinToken: params.pinToken,
          bankAccount: {
            bankCode: params.bankCode,
            accountNumber: params.accountNumber,
            accountName: params.accountName,
          },
        }
      )
      return res.data.data as ZeusPayTransaction
    })
  }

  async getBankAccounts(phone: string, apiKey: string): Promise<ZeusPayBankAccount[]> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).get(
        `/api/v1/partner/users/${encodeURIComponent(phone)}/bank-accounts`
      )
      return res.data.data as ZeusPayBankAccount[]
    })
  }

  async resolveBank(
    accountNumber: string,
    bankCode: string,
    apiKey: string
  ): Promise<{ accountName: string }> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).post('/api/v1/partner/bank-accounts/resolve', {
        accountNumber,
        bankCode,
      })
      return res.data.data as { accountName: string }
    })
  }

  async getBanks(apiKey: string): Promise<{ code: string; name: string }[]> {
    return this.withRetry(async () => {
      const res = await this.client(apiKey).get('/api/v1/partner/bank-accounts/banks')
      return res.data.data as { code: string; name: string }[]
    })
  }

  async saveBankAccount(params: {
    phone: string
    bankCode: string
    accountNumber: string
    accountName: string
    apiKey: string
  }): Promise<void> {
    return this.withRetry(async () => {
      await this.client(params.apiKey).post(
        `/api/v1/partner/users/${encodeURIComponent(params.phone)}/bank-accounts`,
        {
          bankCode: params.bankCode,
          accountNumber: params.accountNumber,
          accountName: params.accountName,
        }
      )
    })
  }
}
