import { describe, expect, it } from 'vitest'
import { evaluateRelease, isNewerVersion, parseVersion, RELEASES_URL } from '../src/shared/updates'
import { normaliseState } from '../src/shared/normalise'
import { makeState } from './helpers'

describe('GitHub Release 版本判断', () => {
  it('按主/次/修订号比较，不能用字符串字典序', () => {
    expect(isNewerVersion('1.10.0', '1.9.9')).toBe(true)
    expect(isNewerVersion('v2.0.0', '1.99.99')).toBe(true)
    expect(isNewerVersion('1.2.7', '1.2.7')).toBe(false)
    expect(isNewerVersion('1.2.6', '1.2.7')).toBe(false)
    expect(parseVersion('v1.2.7-rc.1')).toBeNull()
    expect(parseVersion('not-a-version')).toBeNull()
  })

  it('检测稳定版并使用固定仓库链接，不信任 API 返回的任意跳转 URL', () => {
    expect(evaluateRelease({ tag_name: 'v1.2.8', html_url: 'https://evil.test/' }, '1.2.7'))
      .toEqual({ status: 'available', version: '1.2.8', url: RELEASES_URL })
    expect(evaluateRelease({ tag_name: 'v1.2.7' }, '1.2.7'))
      .toEqual({ status: 'up-to-date', version: '1.2.7' })
  })

  it('拒绝草稿、预发布、非法/不完整响应', () => {
    expect(evaluateRelease({ tag_name: 'v1.2.8', prerelease: true }, '1.2.7').status).toBe('error')
    expect(evaluateRelease({ tag_name: 'v1.2.8', draft: true }, '1.2.7').status).toBe('error')
    expect(evaluateRelease({ tag_name: 'v1.2.8-beta' }, '1.2.7').status).toBe('error')
    expect(evaluateRelease(null, '1.2.7').status).toBe('error')
  })

  it('忽略版本在设置迁移后保留，非法值清空', () => {
    const state = makeState()
    const ignored = normaliseState({
      ...state, settings: {
        ...state.settings, general: { ...state.settings.general, ignoredUpdateVersion: '1.2.8' }
      }
    })
    expect(ignored.settings.general.ignoredUpdateVersion).toBe('1.2.8')
    expect(normaliseState({
      ...state, settings: {
        ...state.settings, general: { ...state.settings.general, ignoredUpdateVersion: 'bad' }
      }
    }).settings.general.ignoredUpdateVersion).toBeNull()
  })
})
