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
    screenId: string
    flowData: Record<string, unknown>
    flowToken: string
    bodyText?: string
    mode?: 'draft' | 'published'
  }): Promise<void> {
    const to = params.to.replace('whatsapp:', '').replace('+', '')

    // Use navigate action when a screenId + flowData is provided so the Flow
    // opens directly at the given screen with pre-populated data.
    // Otherwise fall back to data_exchange (server-driven INIT).
    const hasInitData = params.screenId && Object.keys(params.flowData).length > 0
    const flowAction = hasInitData ? 'navigate' : 'data_exchange'

    const actionParameters: Record<string, unknown> = {
      flow_message_version: '3',
      flow_token: params.flowToken,
      flow_id: params.flowId,
      flow_cta: params.flowCta,
      flow_action: flowAction,
    }

    if (params.mode === 'draft') {
      actionParameters.mode = 'draft'
    }

    if (hasInitData) {
      actionParameters.flow_action_payload = {
        screen: params.screenId,
        data: params.flowData,
      }
    }

    const bodyText = params.bodyText ?? (hasInitData
      ? 'Tap the button below to continue.'
      : 'Review your transaction details and enter your PIN to confirm.')

    const payload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to,
      type: 'interactive',
      interactive: {
        type: 'flow',
        body: { text: bodyText },
        action: {
          name: 'flow',
          parameters: actionParameters,
        },
      },
    }

    console.log('[metaService.sendFlow] payload:', JSON.stringify(payload, null, 2))

    try {
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
    } catch (err: any) {
      // Re-throw with the actual Meta error message attached so callers can log it clearly
      const metaError = err?.response?.data?.error
      if (metaError) {
        const enhanced = new Error(
          `Meta sendFlow ${metaError.code ?? ''} (${metaError.error_subcode ?? ''}): ${metaError.message ?? JSON.stringify(metaError)}`
        )
        ;(enhanced as any).metaError = metaError
        throw enhanced
      }
      throw err
    }
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

  async sendButtons(params: {
    to: string
    phoneNumberId: string
    accessToken: string
    body: string
    buttons: Array<{ id: string; title: string }>
    header?: string
    footer?: string
  }): Promise<void> {
    const to = params.to.replace('whatsapp:', '').replace('+', '')

    await axios.post(
      `${META_API_BASE}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'button',
          ...(params.header ? { header: { type: 'text', text: params.header } } : {}),
          body: { text: params.body },
          ...(params.footer ? { footer: { text: params.footer } } : {}),
          action: {
            buttons: params.buttons.map(b => ({
              type: 'reply',
              reply: { id: b.id, title: b.title },
            })),
          },
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

  async sendList(params: {
    to: string
    phoneNumberId: string
    accessToken: string
    body: string
    buttonText: string
    sections: Array<{
      title?: string
      rows: Array<{
        id: string
        title: string
        description?: string
      }>
    }>
    header?: string
    footer?: string
  }): Promise<void> {
    const to = params.to.replace('whatsapp:', '').replace('+', '')

    await axios.post(
      `${META_API_BASE}/${params.phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to,
        type: 'interactive',
        interactive: {
          type: 'list',
          ...(params.header ? { header: { type: 'text', text: params.header } } : {}),
          body: { text: params.body },
          ...(params.footer ? { footer: { text: params.footer } } : {}),
          action: {
            button: params.buttonText,
            sections: params.sections,
          },
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
