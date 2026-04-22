import { createCanvas } from '@napi-rs/canvas'
import * as os from 'os'
import * as path from 'path'
import * as fs from 'fs'

export interface ReceiptData {
  transactionId: string
  asset: string
  cryptoAmount: string
  ngnAmount: string
  bankName: string
  accountNumber: string  // last 4 digits
  rate: string
  fee: string
  completedAt: string
  botName: string        // partner's bot name e.g. "GoGet"
}

export async function generateReceipt(data: ReceiptData): Promise<Buffer> {
  const WIDTH = 600
  const HEIGHT = 820
  const canvas = createCanvas(WIDTH, HEIGHT)
  const ctx = canvas.getContext('2d')

  // Background
  ctx.fillStyle = '#0F0F0F'
  ctx.fillRect(0, 0, WIDTH, HEIGHT)

  // Top accent bar
  ctx.fillStyle = '#00E5A0'
  ctx.fillRect(0, 0, WIDTH, 6)

  // Brand name
  ctx.fillStyle = '#00E5A0'
  ctx.font = 'bold 28px Arial'
  ctx.textAlign = 'center'
  ctx.fillText(data.botName || 'GoGet', WIDTH / 2, 70)

  // Success icon — green circle
  ctx.beginPath()
  ctx.arc(WIDTH / 2, 140, 40, 0, Math.PI * 2)
  ctx.fillStyle = 'rgba(0, 229, 160, 0.15)'
  ctx.fill()
  ctx.strokeStyle = '#00E5A0'
  ctx.lineWidth = 3
  ctx.stroke()

  // Checkmark
  ctx.beginPath()
  ctx.moveTo(WIDTH / 2 - 16, 140)
  ctx.lineTo(WIDTH / 2 - 4, 154)
  ctx.lineTo(WIDTH / 2 + 18, 126)
  ctx.strokeStyle = '#00E5A0'
  ctx.lineWidth = 4
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.stroke()

  // NGN amount (large)
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 40px Arial'
  ctx.textAlign = 'center'
  ctx.fillText(`\u20A6${data.ngnAmount}`, WIDTH / 2, 230)

  // "Cashout Successful"
  ctx.fillStyle = '#FFFFFF'
  ctx.font = 'bold 26px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('Cashout Successful', WIDTH / 2, 290)

  // Divider
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(40, 320)
  ctx.lineTo(WIDTH - 40, 320)
  ctx.stroke()

  // Detail rows
  const rows: [string, string][] = [
    ['Asset Sold', `${data.cryptoAmount} ${data.asset}`],
    ['Rate', `1 ${data.asset} = \u20A6${parseFloat(data.rate).toLocaleString()}`],
    ['Fee', `\u20A6${parseFloat(data.fee).toLocaleString()}`],
    ['Destination', `${data.bankName} \u2022\u2022\u2022\u2022${data.accountNumber}`],
    ['Status', '\u2705 Completed'],
    ['Date', formatDate(data.completedAt)],
    ['Reference', data.transactionId.slice(0, 18) + '...'],
  ]

  let y = 370
  rows.forEach(([label, value]) => {
    ctx.fillStyle = '#6B7280'
    ctx.font = '15px Arial'
    ctx.textAlign = 'left'
    ctx.fillText(label, 50, y)

    ctx.fillStyle = '#FFFFFF'
    ctx.font = '15px Arial'
    ctx.textAlign = 'right'
    ctx.fillText(value, WIDTH - 50, y)

    ctx.strokeStyle = 'rgba(255,255,255,0.05)'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(50, y + 14)
    ctx.lineTo(WIDTH - 50, y + 14)
    ctx.stroke()

    y += 50
  })

  // Bottom divider
  ctx.strokeStyle = 'rgba(255,255,255,0.08)'
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.moveTo(40, HEIGHT - 90)
  ctx.lineTo(WIDTH - 40, HEIGHT - 90)
  ctx.stroke()

  // Footer
  ctx.fillStyle = '#4A4A5A'
  ctx.font = '13px Arial'
  ctx.textAlign = 'center'
  ctx.fillText('Powered by ZeusPay Infrastructure', WIDTH / 2, HEIGHT - 58)
  ctx.fillText('goget.app', WIDTH / 2, HEIGHT - 38)

  return canvas.toBuffer('image/png') as unknown as Buffer
}

export async function saveReceiptToTmp(
  buffer: Buffer,
  transactionId: string
): Promise<string> {
  const tmpDir = os.tmpdir()
  const filename = `receipt_${transactionId}_${Date.now()}.png`
  const filepath = path.join(tmpDir, filename)
  fs.writeFileSync(filepath, buffer)
  return filepath
}

function formatDate(isoString: string): string {
  const d = new Date(isoString)
  return d.toLocaleString('en-NG', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true,
  })
}
