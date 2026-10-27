import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { browserBackupFormatVersion, decryptBrowserBackup, encryptBrowserBackup } from '../src/shared/browserBackupCrypto'
import { decryptBackup, encryptBackup } from '../src/main/backupCrypto'

const PASSWORD = '正确密码 🍅'
const PLAIN = JSON.stringify({ groups: [], todos: [{ title: '跨设备同步 🔐' }] })

function encryptLegacy(text: string): Buffer {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', scryptSync(PASSWORD, salt, 32), iv)
  const body = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  return Buffer.concat([Buffer.from('TTENC1'), salt, iv, cipher.getAuthTag(), body])
}

describe('浏览器与桌面端 TTENC2 互通', () => {
  it('手机端生成的加密备份可由桌面端解密，随机盐保证每次密文不同', async () => {
    const a = await encryptBrowserBackup(PLAIN, PASSWORD)
    const b = await encryptBrowserBackup(PLAIN, PASSWORD)
    expect(browserBackupFormatVersion(a)).toBe(2)
    expect(decryptBackup(a, PASSWORD)).toBe(PLAIN)
    expect(decryptBackup(b, PASSWORD)).toBe(PLAIN)
    expect(a).not.toEqual(b)
    expect(() => decryptBackup(a, '错误密码')).toThrow('解密失败')
  })

  it('解密桌面端生成的 TTENC2（gzip + scrypt + AES-GCM）', async () => {
    const data = encryptBackup(PLAIN, PASSWORD)
    expect(browserBackupFormatVersion(data)).toBe(2)
    expect(await decryptBrowserBackup(data, PASSWORD)).toBe(PLAIN)
  })

  it('兼容旧版 TTENC1（无 gzip）', async () => {
    const data = encryptLegacy(PLAIN)
    expect(browserBackupFormatVersion(data)).toBe(1)
    expect(await decryptBrowserBackup(data, PASSWORD)).toBe(PLAIN)
  })

  it('密码缺失/错误、数据截断或篡改均不返回明文', async () => {
    const data = encryptBackup(PLAIN, PASSWORD)
    await expect(decryptBrowserBackup(data, '')).rejects.toThrow('请先')
    await expect(decryptBrowserBackup(data, '错误密码')).rejects.toThrow('密码不正确')
    await expect(decryptBrowserBackup(data.subarray(0, 20), PASSWORD)).rejects.toThrow('不完整')
    const damaged = Buffer.from(data)
    damaged[damaged.length - 1] ^= 0xff
    await expect(decryptBrowserBackup(damaged, PASSWORD)).rejects.toThrow('备份文件已损坏')
  })

  it('明文/任意二进制不误判为加密备份', () => {
    expect(browserBackupFormatVersion(new TextEncoder().encode(PLAIN))).toBeNull()
    expect(browserBackupFormatVersion(new Uint8Array([0xff, 0x80, 0, 1, 2, 3]))).toBeNull()
  })
})
