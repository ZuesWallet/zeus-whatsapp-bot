import { metaService } from './meta.service'
import { TwilioService } from './twilio.service'
import type { PartnerConfig } from '../types'

const twilioSvc = new TwilioService()

export async function sendMessage(
  to: string,
  body: string,
  config: PartnerConfig
): Promise<void> {
  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.send({
      to,
      from: config.metaCredentials.phoneNumberId,
      body,
      accessToken: config.metaCredentials.accessToken,
      phoneNumberId: config.metaCredentials.phoneNumberId,
    })
  } else {
    await twilioSvc.send({
      to,
      from: config.whatsappNumber,
      body,
      credentials: config.twilioCredentials,
    })
  }
}

export async function sendMessageWithImage(
  to: string,
  body: string,
  imageBuffer: Buffer,
  config: PartnerConfig,
  publicBotUrl: string
): Promise<void> {
  if (config.bspType === 'META_CLOUD' && config.metaCredentials) {
    await metaService.sendImage({
      to,
      phoneNumberId: config.metaCredentials.phoneNumberId,
      accessToken: config.metaCredentials.accessToken,
      imageBuffer,
      caption: body,
    })
  } else {
    const filename = `receipt_${Date.now()}.png`
    await twilioSvc.sendWithImage({
      to,
      from: config.whatsappNumber,
      body,
      imageBuffer,
      filename,
      credentials: config.twilioCredentials,
      publicBaseUrl: publicBotUrl,
    })
  }
}
