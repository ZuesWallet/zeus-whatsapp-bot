import { Router, Request, Response } from 'express'
import { RoutingService } from '../services/routing.service'
import { SessionService } from '../services/session.service'
import { sendMessage, sendMessageWithImage } from '../services/sender.service'
import { generateReceipt } from '../services/receipt.service'

const router = Router()
const routing = new RoutingService()
const sessionSvc = new SessionService()

// Template strings hardcoded for V1 — no DB lookup needed at runtime
const TEMPLATES: Record<string, string> = {
  cashout_initiated:
    '⏳ *Cashout Processing*\n\n₦{{1}} is on its way to your {{2}} account ending in ••••{{3}}.\n\nThis usually takes under 5 minutes. You\'ll receive a receipt here when it\'s done.',
  cashout_completed:
    'Your cashout of {{1}} {{2}} is complete. ₦{{3}} has been sent to your {{4}} account ending in {{5}}. 🎉',
  deposit_confirmed:
    '✅ Deposit confirmed. {{1}} {{2}} (≈ ₦{{3}}) has been credited to your wallet.',
  cashout_failed:
    '❌ Your cashout of ₦{{1}} could not be completed. Reason: {{2}}. Type *cash out* to try again.',
  rate_alert:
    '📈 Rate alert: 1 USDT is now ₦{{1}}. Type *cash out* to sell now.',
  welcome_onboarding:
    'Welcome to {{1}}! 👋 You can now cash out crypto, check rates, and manage your wallet. Reply *help* to see all commands.',
}

function applyVariables(template: string, variables: string[]): string {
  return template.replace(/\{\{(\d+)\}\}/g, (_, idx) => {
    return variables[parseInt(idx) - 1] ?? `{{${idx}}}`
  })
}

// Middleware: verify X-Service-Secret header
function requireServiceSecret(req: Request, res: Response, next: () => void): void {
  const secret = process.env.SERVICE_SECRET
  if (!secret || req.headers['x-service-secret'] !== secret) {
    res.status(401).json({ success: false, error: 'Unauthorized' })
    return
  }
  next()
}

// POST /internal/notify
router.post('/notify', requireServiceSecret, async (req: Request, res: Response) => {
  try {
    const {
      whatsappNumber,
      userPhone,
      templateName,
      variables,
    } = req.body as {
      whatsappNumber: string
      userPhone: string
      templateName: string
      variables: string[]
    }

    if (!whatsappNumber || !userPhone || !templateName || !Array.isArray(variables)) {
      res.status(400).json({ success: false, error: 'Missing required fields' })
      return
    }

    const template = TEMPLATES[templateName]
    if (!template) {
      res.status(400).json({ success: false, error: `Unknown template: ${templateName}` })
      return
    }

    // Resolve partner config
    let config
    try {
      config = await routing.resolve(whatsappNumber)
    } catch (err: any) {
      res.status(404).json({ success: false, error: `Partner not found: ${err.message}` })
      return
    }

    const body = applyVariables(template, variables)

    const receiptData = (req.body as any).receiptData
    const publicBotUrl = process.env.PUBLIC_BOT_URL || ''

    if (receiptData) {
      try {
        const receiptBuffer = await generateReceipt({
          ...receiptData,
          botName: config.botName || 'GoGet',
        })
        await sendMessageWithImage(userPhone, body, receiptBuffer, config, publicBotUrl)
      } catch (receiptErr) {
        console.error('[Internal] Receipt generation failed, sending text only:', receiptErr)
        await sendMessage(userPhone, body, config)
      }
    } else {
      await sendMessage(userPhone, body, config)
    }

    res.json({ success: true, data: { sent: true, to: userPhone, via: config.bspType } })
  } catch (err: any) {
    console.error('[Internal] notify error:', err)
    res.status(500).json({ success: false, error: 'Failed to send notification' })
  }
})

// POST /internal/cache/invalidate
// Called by backend when a partner updates their WhatsApp config
router.post('/cache/invalidate', requireServiceSecret, async (req: Request, res: Response) => {
  try {
    const { whatsappNumber } = req.body as { whatsappNumber: string }
    if (!whatsappNumber) {
      res.status(400).json({ success: false, error: 'whatsappNumber required' })
      return
    }
    await routing.invalidate(whatsappNumber)
    res.json({ success: true })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

// DELETE /internal/session
// Clears a stuck session for a specific user+partner combination.
// Body: { phone: "+2348012345678", partnerId: "abc123" }
router.delete('/session', requireServiceSecret, async (req: Request, res: Response) => {
  try {
    const { phone, partnerId } = req.body as { phone: string; partnerId: string }
    if (!phone || !partnerId) {
      res.status(400).json({ success: false, error: 'phone and partnerId required' })
      return
    }
    await sessionSvc.clear(phone, partnerId)
    res.json({ success: true, data: { cleared: true, phone, partnerId } })
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message })
  }
})

export default router
