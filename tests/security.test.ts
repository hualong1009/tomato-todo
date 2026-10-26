import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../src/main/security'

describe('管理员密码哈希', () => {
  it('正确密码验证通过，错误密码验证失败', () => {
    const stored = hashPassword('s3cret-pass')
    expect(stored.startsWith('scrypt$')).toBe(true)
    expect(verifyPassword('s3cret-pass', stored)).toBe(true)
    expect(verifyPassword('wrong-pass', stored)).toBe(false)
  })

  it('同一密码两次哈希结果不同（随机盐）', () => {
    expect(hashPassword('same')).not.toBe(hashPassword('same'))
  })

  it('空密码或空哈希直接拒绝', () => {
    expect(verifyPassword('', hashPassword('x'))).toBe(false)
    expect(verifyPassword('x', '')).toBe(false)
    expect(verifyPassword('', '')).toBe(false)
  })

  it('损坏的哈希格式不会抛出异常', () => {
    expect(verifyPassword('x', 'not-a-hash')).toBe(false)
    expect(verifyPassword('x', 'scrypt$zz$zz')).toBe(false)
    expect(verifyPassword('x', 'md5$abcd$1234')).toBe(false)
  })
})
