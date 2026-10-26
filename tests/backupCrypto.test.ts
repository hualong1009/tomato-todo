import { createCipheriv, randomBytes, scryptSync } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  BACKUP_FORMAT_VERSION,
  backupFormatVersion,
  decryptBackup,
  encryptBackup,
  isEncryptedBackup
} from '../src/main/backupCrypto'

/** 构造旧版 TTENC1 备份（明文直接加密，无 gzip），用于验证向后兼容。 */
function encryptLegacyV1(plaintext: string, password: string): Buffer {
  const magic = Buffer.from('TTENC1', 'utf8')
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = scryptSync(password, salt, 32)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([magic, salt, iv, cipher.getAuthTag(), body])
}

const PLAIN = JSON.stringify({ app: 'tomato-todo', todos: [{ title: '秘密待办' }] })

describe('备份加密', () => {
  it('加解密往返成功', () => {
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    expect(isEncryptedBackup(encrypted)).toBe(true)
    expect(decryptBackup(encrypted, 'my-pass')).toBe(PLAIN)
  })

  it('密文不包含明文内容', () => {
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    expect(encrypted.toString('utf8')).not.toContain('秘密待办')
    expect(encrypted.toString('utf8')).not.toContain('tomato-todo')
  })

  it('同一明文两次加密产生不同密文（随机盐与 IV）', () => {
    const a = encryptBackup(PLAIN, 'my-pass')
    const b = encryptBackup(PLAIN, 'my-pass')
    expect(a.equals(b)).toBe(false)
  })

  it('错误密码解密失败并给出可读错误', () => {
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    expect(() => decryptBackup(encrypted, 'other')).toThrow('解密失败')
  })

  it('密文被篡改时 GCM 校验失败', () => {
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    encrypted[encrypted.length - 1] ^= 0xff
    expect(() => decryptBackup(encrypted, 'my-pass')).toThrow('解密失败')
  })

  it('空密码不允许加密', () => {
    expect(() => encryptBackup(PLAIN, '')).toThrow('未设置加密密码')
  })

  it('明文 JSON 不会被误判为加密备份', () => {
    expect(isEncryptedBackup(Buffer.from(PLAIN, 'utf8'))).toBe(false)
    expect(() => decryptBackup(Buffer.from(PLAIN, 'utf8'), 'my-pass')).toThrow('不是加密格式')
  })

  it('截断的加密数据解密失败', () => {
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    expect(() => decryptBackup(encrypted.subarray(0, 20), 'my-pass')).toThrow('不完整')
  })
})

describe('备份格式 TTENC2（gzip + AES-GCM）', () => {
  it('当前写入的格式版本是 TTENC2', () => {
    expect(BACKUP_FORMAT_VERSION).toBe(2)
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    expect(encrypted.subarray(0, 6).toString('utf8')).toBe('TTENC2')
    expect(backupFormatVersion(encrypted)).toBe(2)
    expect(backupFormatVersion(encryptLegacyV1(PLAIN, 'my-pass'))).toBe(1)
    expect(backupFormatVersion(Buffer.from(PLAIN, 'utf8'))).toBeNull()
  })

  it('文本类备份压缩后体积显著变小', () => {
    const bulky = JSON.stringify({
      app: 'tomato-todo',
      todos: Array.from({ length: 50 }, (_unused, index) => ({
        id: String(index),
        title: `待办 ${index}`,
        content: '这是一段比较长的中文正文内容，用来验证压缩效果。'.repeat(40)
      }))
    })
    const v1Size = encryptLegacyV1(bulky, 'my-pass').byteLength
    const v2Size = encryptBackup(bulky, 'my-pass').byteLength
    expect(v2Size).toBeLessThan(v1Size / 5)
    expect(decryptBackup(encryptBackup(bulky, 'my-pass'), 'my-pass')).toBe(bulky)
  })

  it('继续支持解密旧版 TTENC1 备份', () => {
    const legacy = encryptLegacyV1(PLAIN, 'my-pass')
    expect(isEncryptedBackup(legacy)).toBe(true)
    expect(decryptBackup(legacy, 'my-pass')).toBe(PLAIN)
    expect(() => decryptBackup(legacy, 'other')).toThrow('解密失败')
  })

  it('TTENC2 密文被篡改时校验失败', () => {
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    encrypted[encrypted.length - 1] ^= 0xff
    expect(() => decryptBackup(encrypted, 'my-pass')).toThrow('解密失败')
  })

  it('TTENC2 数据被截断时给出可读错误', () => {
    const encrypted = encryptBackup(PLAIN, 'my-pass')
    expect(() => decryptBackup(encrypted.subarray(0, 20), 'my-pass')).toThrow('不完整')
  })
})
