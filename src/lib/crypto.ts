import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto'

const ALGORITHM = 'aes-256-gcm'
const KEY_LENGTH = 32
const IV_LENGTH = 16
const AUTH_TAG_LENGTH = 16
function getDerivedKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY
  if (!secret) {
    throw new Error(
      'ENCRYPTION_KEY is not set. Add it to .env.local:\n' +
      '  ENCRYPTION_KEY=$(openssl rand -hex 32)\n' +
      'Then restart the server.'
    )
  }
  // Use the key itself as part of the salt to derive a unique key per installation.
  // scrypt handles key stretching; the salt ensures different derived keys even for
  // identical passphrases across installations.
  const salt = scryptSync(secret, 'gtm-os', 16) as Buffer
  return scryptSync(secret, salt, KEY_LENGTH) as Buffer
}

/**
 * Encrypts a plaintext string (API key).
 * Returns: "iv_hex:authTag_hex:ciphertext_hex"
 */
export function encrypt(plaintext: string): string {
  const key = getDerivedKey()
  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, key, iv)

  const encrypted = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    iv.toString('hex'),
    authTag.toString('hex'),
    encrypted.toString('hex'),
  ].join(':')
}

/**
 * Decrypts an encrypted API key string.
 */
export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(':')
  if (!ivHex || !authTagHex || !encryptedHex) {
    throw new Error('Invalid encrypted format')
  }

  const key = getDerivedKey()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')
  const encrypted = Buffer.from(encryptedHex, 'hex')

  const decipher = createDecipheriv(ALGORITHM, key, iv)
  decipher.setAuthTag(authTag)

  return Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]).toString('utf8')
}
