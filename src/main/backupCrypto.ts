import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

/**
 * WebDAV 备份加密格式（AES-256-GCM）：
 *   "TTENC1"(6B) + salt(16B) + iv(12B) + tag(16B) + ciphertext
 * 密钥通过 scrypt(密码, salt, 32) 派生，每次加密使用随机 salt 与 iv。
 */
const MAGIC = Buffer.from('TTENC1', 'utf8')
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16
const HEADER_LENGTH = MAGIC.length + SALT_LENGTH + IV_LENGTH + TAG_LENGTH

export function encryptBackup(plaintext: string, password: string): Buffer {
  if (!password) throw new Error('未设置加密密码')
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = scryptSync(password, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC, salt, iv, tag, body])
}

export function isEncryptedBackup(data: Uint8Array): boolean {
  if (data.length < MAGIC.length) return false
  return Buffer.from(data.buffer, data.byteOffset, MAGIC.length).toString('utf8') === 'TTENC1'
}

export function decryptBackup(data: Uint8Array, password: string): string {
  if (!isEncryptedBackup(data)) throw new Error('备份文件不是加密格式')
  if (!password) throw new Error('请先在设置中填写 WebDAV 加密密码')
  const buffer = Buffer.from(data)
  if (buffer.length < HEADER_LENGTH) throw new Error('加密备份数据不完整')
  const salt = buffer.subarray(MAGIC.length, MAGIC.length + SALT_LENGTH)
  const iv = buffer.subarray(MAGIC.length + SALT_LENGTH, MAGIC.length + SALT_LENGTH + IV_LENGTH)
  const tag = buffer.subarray(
    MAGIC.length + SALT_LENGTH + IV_LENGTH,
    MAGIC.length + SALT_LENGTH + IV_LENGTH + TAG_LENGTH
  )
  const body = buffer.subarray(HEADER_LENGTH)
  const key = scryptSync(password, salt, 32)
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    return Buffer.concat([decipher.update(body), decipher.final()]).toString('utf8')
  } catch {
    throw new Error('解密失败：加密密码不正确或备份文件已损坏')
  }
}
