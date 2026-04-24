import axios from 'axios'
import { getRedisClient } from '../lib/redis'
import { decryptCredentials } from './crypto.service'
import type { PartnerConfig } from '../types'

const CACHE_TTL = 300 // 5 minutes
const CACHE_KEY = (number: string) => `wa_routing:${number}`

export class RoutingService {
  // Resolve a WhatsApp number to full partner config.
  // Called on every inbound message — Redis-cached for 5 minutes.
  async resolve(whatsappNumber: string): Promise<PartnerConfig> {
    const normalised = whatsappNumber.startsWith('+') ? whatsappNumber : '+' + whatsappNumber
    const redis = getRedisClient()
    const cacheKey = CACHE_KEY(normalised)

    // 1. Check cache
    const cached = await redis.get(cacheKey)
    if (cached) {
      return JSON.parse(cached) as PartnerConfig
    }

    // 2. Fetch from backend resolve endpoint
    const apiUrl = process.env.ZEUSPAY_API_URL || 'http://localhost:3000'
    const serviceSecret = process.env.SERVICE_SECRET || ''

    let data: {
      partnerId: string
      partnerApiKey: string
      config: {
        botName: string
        welcomeMessage: string | null
        fallbackMessage: string | null
        fallbackWebhook: string | null
        enabledCommands: string[]
        notificationsEnabled: boolean
        bspType: string
        bspCredentials: string
      }
    }

    try {
      const response = await axios.get(
        `${apiUrl}/api/v1/admin/whatsapp/resolve`,
        {
          params: { number: normalised },
          headers: { 'X-Service-Secret': serviceSecret },
          timeout: 5000,
        }
      )
      data = response.data.data
    } catch (err: any) {
      const status = err.response?.status
      if (status === 404) {
        throw new Error(`WhatsApp number not configured or not active: ${normalised}`)
      }
      throw new Error(`Failed to resolve WhatsApp number ${normalised}: ${err.message}`)
    }

    // 3. Decrypt BSP credentials
    const bspType = (data.config.bspType || 'TWILIO') as PartnerConfig['bspType']

    let twilioCredentials: { accountSid: string; authToken: string; messagingServiceSid: string }
    let metaCredentials: PartnerConfig['metaCredentials']

    try {
      const creds = decryptCredentials(data.config.bspCredentials)

      if (bspType === 'META_CLOUD') {
        // Credentials stored as MetaCloudCredentials: { accessToken, phoneNumberId, wabaId }
        const meta = creds as { accessToken?: string; phoneNumberId?: string; wabaId?: string }
        metaCredentials = {
          accessToken: meta.accessToken || process.env.META_ACCESS_TOKEN || '',
          phoneNumberId: meta.phoneNumberId || process.env.META_PHONE_NUMBER_ID || '',
          wabaId: meta.wabaId || process.env.META_WABA_ID || '',
        }
        // Twilio fields not used for Meta — fill with empty strings to satisfy the type
        twilioCredentials = { accountSid: '', authToken: '', messagingServiceSid: '' }
      } else {
        twilioCredentials = {
          accountSid: (creds as { accountSid?: string }).accountSid || '',
          authToken: (creds as { authToken?: string }).authToken || '',
          messagingServiceSid: (creds as { messagingServiceSid?: string }).messagingServiceSid || '',
        }
      }
    } catch (err: any) {
      throw new Error(`Failed to decrypt BSP credentials for ${normalised}: ${err.message}`)
    }

    // 4. Build PartnerConfig
    const partnerConfig: PartnerConfig = {
      partnerId: data.partnerId,
      partnerApiKey: data.partnerApiKey,
      botName: data.config.botName,
      welcomeMessage: data.config.welcomeMessage,
      fallbackMessage: data.config.fallbackMessage,
      fallbackWebhook: data.config.fallbackWebhook,
      enabledCommands: data.config.enabledCommands as PartnerConfig['enabledCommands'],
      notificationsEnabled: data.config.notificationsEnabled,
      bspType,
      whatsappNumber: normalised,
      twilioCredentials,
      metaCredentials,
    }

    // 5. Cache
    await redis.set(cacheKey, JSON.stringify(partnerConfig), 'EX', CACHE_TTL)

    return partnerConfig
  }

  // Invalidate cache for a number (call when partner updates their config)
  async invalidate(whatsappNumber: string): Promise<void> {
    const redis = getRedisClient()
    await redis.del(CACHE_KEY(whatsappNumber))
  }
}
