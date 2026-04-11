import twilio from 'twilio'

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
