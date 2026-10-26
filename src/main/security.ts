import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto'

/** 生成 scrypt 哈希：scrypt$<salt>$<hash> */
export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex')
  const hash = scryptSync(password, salt, 32).toString('hex')
  return `scrypt$${salt}$${hash}`
}

/** 恒定时间比较，避免时序侧信道。 */
export function verifyPassword(password: string, stored: string): boolean {
  if (!password || !stored) return false
  const parts = stored.split('$')
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false
  const [, salt, expected] = parts
  if (!/^[0-9a-f]+$/i.test(salt) || !/^[0-9a-f]+$/i.test(expected)) return false
  try {
    const actual = scryptSync(password, salt, 32)
    const reference = Buffer.from(expected, 'hex')
    return actual.length === reference.length && timingSafeEqual(actual, reference)
  } catch {
    return false
  }
}
