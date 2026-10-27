import { scryptAsync } from '@noble/hashes/scrypt'
import { gunzipSync, gzipSync } from 'fflate'

/**
 * 浏览器 / Android WebView 版 TTENC1 / TTENC2 解密。
 * 与主进程 backupCrypto.ts 的格式完全相同：
 * "TTENCx"(6) + salt(16) + iv(12) + GCM tag(16) + ciphertext。
 * TTENC2 的明文先经过 gzip 压缩。此模块禁止依赖 Node API。
 */
const HEADER_LENGTH = 6 + 16 + 12 + 16
const decoder = new TextDecoder('utf-8', { fatal: true })
const encoder = new TextEncoder()

export function browserBackupFormatVersion(data: Uint8Array): 1 | 2 | null {
  if (data.length < 6) return null
  if (data[0] !== 84 || data[1] !== 84 || data[2] !== 69 ||
      data[3] !== 78 || data[4] !== 67) return null
  if (data[5] === 49) return 1
  if (data[5] === 50) return 2
  return null
}

/** 写出桌面端可读取的 TTENC2 容器：每次使用独立随机 salt 与 IV。 */
export async function encryptBrowserBackup(plaintext: string, password: string): Promise<Uint8Array> {
  if (!password) throw new Error('未设置加密密码')
  if (!globalThis.crypto?.subtle) throw new Error('当前设备不支持备份加密（Web Crypto 不可用）')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const keyBytes = await scryptAsync(encoder.encode(password), salt, {
    N: 16384, r: 8, p: 1, dkLen: 32
  })
  const key = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), 'AES-GCM', false, ['encrypt'])
  const compressed = gzipSync(encoder.encode(plaintext), { level: 6 })
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv), tagLength: 128 },
    key,
    new Uint8Array(compressed)
  ))
  const bodyLength = encrypted.length - 16
  // Web Crypto 产生 ciphertext + tag，Node 备份格式要求 tag + ciphertext。
  const output = new Uint8Array(HEADER_LENGTH + bodyLength)
  output.set(encoder.encode('TTENC2'))
  output.set(salt, 6)
  output.set(iv, 22)
  output.set(encrypted.subarray(bodyLength), 34)
  output.set(encrypted.subarray(0, bodyLength), HEADER_LENGTH)
  return output
}

export async function decryptBrowserBackup(data: Uint8Array, password: string): Promise<string> {
  const version = browserBackupFormatVersion(data)
  if (!version) throw new Error('备份文件不是加密格式')
  if (!password) throw new Error('请先在设置中填写 WebDAV 加密密码')
  if (data.length < HEADER_LENGTH) throw new Error('加密备份数据不完整')
  if (!globalThis.crypto?.subtle) throw new Error('当前设备不支持备份解密（Web Crypto 不可用）')

  const salt = data.subarray(6, 22)
  const iv = data.subarray(22, 34)
  const tag = data.subarray(34, 50)
  const body = data.subarray(50)
  // Node scryptSync 的默认参数：N=16384、r=8、p=1、dkLen=32。
  // 异步派生让 UI 在大备份恢复时仍可响应。
  const keyBytes = await scryptAsync(encoder.encode(password), salt, {
    N: 16384,
    r: 8,
    p: 1,
    dkLen: 32
  })
  const key = await crypto.subtle.importKey('raw', new Uint8Array(keyBytes), 'AES-GCM', false, ['decrypt'])
  // Node 容器把 GCM tag 放在密文之前；Web Crypto 要求 tag 附在密文末尾。
  const encrypted = new Uint8Array(body.length + tag.length)
  encrypted.set(body)
  encrypted.set(tag, body.length)
  let decoded: Uint8Array
  try {
    const result = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: new Uint8Array(iv), tagLength: 128 },
      key,
      encrypted
    )
    decoded = new Uint8Array(result)
  } catch {
    throw new Error('解密失败：加密密码不正确或备份文件已损坏')
  }
  if (version === 1) return decoder.decode(decoded)
  try {
    return decoder.decode(gunzipSync(decoded))
  } catch {
    throw new Error('解密失败：备份内容已损坏（gzip 解压失败）')
  }
}
