import crypto from 'crypto'

// Decrypt BSP credentials stored encrypted in WhatsAppConfig.bspCredentials
// Uses the same AES-256-GCM scheme as the backend:
//   Format: base64(iv):base64(authTag):base64(ciphertext)
//   Key:    ENCRYPTION_KEY env var (64 hex chars = 32 bytes)

export function decryptCredentials(encrypted: string): Record<string, string> {
  const keyHex = process.env.ENCRYPTION_KEY
  if (!keyHex || keyHex.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be 64 hex characters (32 bytes)')
  }

  const parts = encrypted.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted credential format — expected iv:authTag:ciphertext')
  }

  const [ivB64, authTagB64, ciphertextB64] = parts

  try {
    const key = Buffer.from(keyHex, 'hex')
    const iv = Buffer.from(ivB64, 'base64')
    const authTag = Buffer.from(authTagB64, 'base64')

    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(authTag)

    let decrypted = decipher.update(ciphertextB64, 'base64', 'utf8')
    decrypted += decipher.final('utf8')

    return JSON.parse(decrypted) as Record<string, string>
  } catch (err) {
    throw new Error(
      `Failed to decrypt BSP credentials — check ENCRYPTION_KEY matches backend: ${err instanceof Error ? err.message : err}`
    )
  }
}
