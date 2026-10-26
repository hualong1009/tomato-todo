import { describe, expect, it } from 'vitest'
import {
  decryptBackup,
  encryptBackup,
  isEncryptedBackup
} from '../src/main/backupCrypto'

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
