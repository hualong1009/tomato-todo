import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'
import { gunzipSync, gzipSync } from 'node:zlib'

/**
 * 备份加密格式（AES-256-GCM）：
 *
 *   TTENC1（旧格式，仅解密读取）：
 *     "TTENC1"(6B) + salt(16B) + iv(12B) + tag(16B) + ciphertext(明文)
 *   TTENC2（当前格式，先 gzip 再加密）：
 *     "TTENC2"(6B) + salt(16B) + iv(12B) + tag(16B) + ciphertext(gzip(明文))
 *
 * 密钥通过 scrypt(密码, salt, 32) 派生，每次加密使用随机 salt 与 iv。
 * 先压缩再加密可以显著减小备份体积（纯文本待办通常缩小两个数量级），
 * 同时对已压缩的内嵌图片（WebP）无副作用。
 */
const MAGIC_V1 = Buffer.from('TTENC1', 'utf8')
const MAGIC_V2 = Buffer.from('TTENC2', 'utf8')
const SALT_LENGTH = 16
const IV_LENGTH = 12
const TAG_LENGTH = 16
const HEADER_LENGTH = MAGIC_V2.length + SALT_LENGTH + IV_LENGTH + TAG_LENGTH

/** 加密时使用的数据格式版本，写入 magic 由解密端自动识别。 */
export const BACKUP_FORMAT_VERSION = 2

export function encryptBackup(plaintext: string, password: string): Buffer {
  if (!password) throw new Error('未设置加密密码')
  const salt = randomBytes(SALT_LENGTH)
  const iv = randomBytes(IV_LENGTH)
  const key = scryptSync(password, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const compressed = gzipSync(Buffer.from(plaintext, 'utf8'), { level: 6 })
  const body = Buffer.concat([cipher.update(compressed), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([MAGIC_V2, salt, iv, tag, body])
}

/** 读取备份数据的格式版本：1 = TTENC1，2 = TTENC2，null = 非加密备份。 */
export function backupFormatVersion(data: Uint8Array): 1 | 2 | null {
  if (data.length < MAGIC_V2.length) return null
  const head = Buffer.from(data.buffer, data.byteOffset, MAGIC_V2.length)
  if (head.equals(MAGIC_V2)) return 2
  if (head.equals(MAGIC_V1)) return 1
  return null
}

export function isEncryptedBackup(data: Uint8Array): boolean {
  return backupFormatVersion(data) !== null
}

export function decryptBackup(data: Uint8Array, password: string): string {
  const version = backupFormatVersion(data)
  if (!version) throw new Error('备份文件不是加密格式')
  if (!password) throw new Error('请先在设置中填写 WebDAV 加密密码')
  const buffer = Buffer.from(data)
  if (buffer.length < HEADER_LENGTH) throw new Error('加密备份数据不完整')
  const salt = buffer.subarray(MAGIC_V2.length, MAGIC_V2.length + SALT_LENGTH)
  const iv = buffer.subarray(MAGIC_V2.length + SALT_LENGTH, MAGIC_V2.length + SALT_LENGTH + IV_LENGTH)
  const tag = buffer.subarray(
    MAGIC_V2.length + SALT_LENGTH + IV_LENGTH,
    MAGIC_V2.length + SALT_LENGTH + IV_LENGTH + TAG_LENGTH
  )
  const body = buffer.subarray(HEADER_LENGTH)
  const key = scryptSync(password, salt, 32)
  let decoded: Buffer
  try {
    const decipher = createDecipheriv('aes-256-gcm', key, iv)
    decipher.setAuthTag(tag)
    decoded = Buffer.concat([decipher.update(body), decipher.final()])
  } catch {
    throw new Error('解密失败：加密密码不正确或备份文件已损坏')
  }
  if (version === 1) return decoded.toString('utf8')
  try {
    return gunzipSync(decoded).toString('utf8')
  } catch {
    throw new Error('解密失败：备份内容已损坏（gzip 解压失败）')
  }
}
