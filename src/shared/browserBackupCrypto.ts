import { scryptAsync } from '@noble/hashes/scrypt'
import { gunzipSync } from 'fflate'

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
