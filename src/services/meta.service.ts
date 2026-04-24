import axios from 'axios'
import crypto from 'crypto'

const META_API_BASE = 'https://graph.facebook.com/v19.0'

export class MetaService {
  async send(params: {
    to: string
    from: string
    body: string
    accessToken: string
    phoneNumberId: string
  }): Promise<void> {
    const to = params.to.replace('whatsapp:', '').replace('+', '')

    await axios.post(
      `${META_API_BASE}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'text',
        text: {
          preview_url: false,
          body: params.body,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    )
  }

  async sendFlow(params: {
    to: string
    phoneNumberId: string
    accessToken: string
    flowId: string
    flowCta: string
    screenId: string          // for reference only — not sent inline in data_exchange mode
    flowData: Record<string, unknown>  // for reference only — backend serves data on INIT
    flowToken: string         // unique per cashout — backend uses this to look up screen data
  }): Promise<void> {
    const to = params.to.replace('whatsapp:', '').replace('+', '')

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: {
          text: 'Review your transaction details and enter your PIN to confirm.',
        },
        action: {
          name: 'flow',
          parameters: {
            flow_message_version: '3',
            flow_token: params.flowToken,
            flow_id: params.flowId,
            flow_cta: params.flowCta,
            flow_action: 'data_exchange',
          },
        },
      },
    }

    console.log('[metaService.sendFlow] payload:', JSON.stringify(payload, null, 2))

    await axios.post(
      `${META_API_BASE}/${params.phoneNumberId}/messages`,
      payload,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    )
  }

  async sendImage(params: {
    to: string
    phoneNumberId: string
    accessToken: string
    imageBuffer: Buffer
    caption: string
  }): Promise<void> {
    const to = params.to.replace('whatsapp:', '').replace('+', '')

    // Upload image to Meta media API using native FormData (Node 18+)
    // Uint8Array cast needed because TypeScript's Buffer type uses ArrayBufferLike, not ArrayBuffer
    const blob = new Blob([new Uint8Array(params.imageBuffer)], { type: 'image/png' })
    const form = new FormData()
    form.append('file', blob, 'receipt.png')
    form.append('type', 'image/png')
    form.append('messaging_product', 'whatsapp')

    const uploadResponse = await axios.post(
      `${META_API_BASE}/${params.phoneNumberId}/media`,
      form,
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
        },
        timeout: 30000,
      }
    )

    const mediaId: string = uploadResponse.data.id

    await axios.post(
      `${META_API_BASE}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'image',
        image: {
          id: mediaId,
          caption: params.caption,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${params.accessToken}`,
          'Content-Type': 'application/json',
        },
        timeout: 15000,
      }
    )
  }

  // Meta signs the raw body with HMAC-SHA256 using the App Secret.
  // Header: x-hub-signature-256
  verifySignature(rawBody: Buffer, signature: string, appSecret: string): boolean {
    const expected =
      'sha256=' +
      crypto.createHmac('sha256', appSecret).update(rawBody).digest('hex')
    try {
      return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
    } catch {
      return false
    }
  }
}

export const metaService = new MetaService()
