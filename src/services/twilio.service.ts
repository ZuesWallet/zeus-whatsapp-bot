import twilio from 'twilio'

interface CachedReceipt {
  buffer: Buffer
  expiresAt: number
}

export const receiptCache = new Map<string, CachedReceipt>()

// Clean up expired receipts every 10 minutes
setInterval(() => {
  const now = Date.now()
  for (const [key, val] of receiptCache.entries()) {
    if (val.expiresAt < now) receiptCache.delete(key)
  }
}, 10 * 60 * 1000)

export class TwilioService {
  // Send a WhatsApp message using partner's Twilio credentials
  async send(params: {
    to: string
    from: string
    body: string
    credentials: {
      accountSid: string
      authToken: string
      messagingServiceSid: string
    }
  }): Promise<void> {
    const { credentials, to, from, body } = params
    const client = twilio(credentials.accountSid, credentials.authToken)

    // Only use messagingServiceSid if it looks like a real SID (starts with 'MG')
    const validMsid = credentials.messagingServiceSid?.startsWith('MG')
      ? credentials.messagingServiceSid
      : undefined

    try {
      const message = await client.messages.create({
        from: `whatsapp:${from}`,
        to: `whatsapp:${to}`,
        body,
        ...(validMsid ? { messagingServiceSid: validMsid } : {}),
      })
      console.log(`[Twilio] Message sent SID=${message.sid} to=${to}`)
    } catch (err: any) {
      const e = new Error(`Twilio delivery failed: ${err.message}`) as Error & {
        code?: number
        twilioCode?: number
      }
      e.twilioCode = err.code
      throw e
    }
  }

  async sendWithImage(params: {
    to: string
    from: string
    body: string
    imageBuffer: Buffer
    filename: string
    credentials: {
      accountSid: string
      authToken: string
      messagingServiceSid: string
    }
    publicBaseUrl: string
  }): Promise<void> {
    receiptCache.set(params.filename, {
      buffer: params.imageBuffer,
      expiresAt: Date.now() + 5 * 60 * 1000,
    })

    const mediaUrl = `${params.publicBaseUrl}/receipt/${params.filename}`
    const client = twilio(params.credentials.accountSid, params.credentials.authToken)

    const validMsid = params.credentials.messagingServiceSid?.startsWith('MG')
      ? params.credentials.messagingServiceSid
      : undefined

    try {
      const message = await client.messages.create({
        from: `whatsapp:${params.from}`,
        to: `whatsapp:${params.to}`,
        body: params.body,
        mediaUrl: [mediaUrl],
        ...(validMsid ? { messagingServiceSid: validMsid } : {}),
      })
      console.log(`[Twilio] Media message sent SID=${message.sid} to=${params.to}`)
    } catch (err: any) {
      const e = new Error(`Twilio delivery failed: ${err.message}`) as Error & { twilioCode?: number }
      e.twilioCode = err.code
      throw e
    }
  }

  // Verify a Twilio webhook signature
  verifySignature(params: {
    url: string
    signature: string
    body: Record<string, string>
    authToken: string
  }): boolean {
    return twilio.validateRequest(
      params.authToken,
      params.signature,
      params.url,
      params.body
    )
  }
}
