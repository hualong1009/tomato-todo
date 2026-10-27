/** 公共仓库的稳定版 Release；不需要 GitHub token。 */
export const RELEASES_URL = 'https://github.com/hualong1009/tomato-todo/releases/latest'
export const LATEST_RELEASE_API = 'https://api.github.com/repos/hualong1009/tomato-todo/releases/latest'

export type UpdateCheckResult =
  | { status: 'available'; version: string; url: string }
  | { status: 'up-to-date'; version: string }
  | { status: 'error'; message: string }

/** 仅接受 x.y.z / vx.y.z，避免其他标签或非正式版误报更新。 */
export function parseVersion(value: string): [number, number, number] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value.trim())
  if (!match) return null
  const parts = match.slice(1).map(Number)
  if (parts.some((part) => !Number.isSafeInteger(part))) return null
  return [parts[0], parts[1], parts[2]]
}

export function isNewerVersion(latest: string, current: string): boolean {
  const next = parseVersion(latest)
  const installed = parseVersion(current)
  if (!next || !installed) return false
  for (let i = 0; i < 3; i += 1) {
    if (next[i] !== installed[i]) return next[i] > installed[i]
  }
  return false
}

/** 校验 GitHub API 响应；下载链接始终使用固定仓库 URL，不信任远端 html_url。 */
export function evaluateRelease(raw: unknown, currentVersion: string): UpdateCheckResult {
  if (!raw || typeof raw !== 'object') return { status: 'error', message: '更新信息格式不正确' }
  const release = raw as { tag_name?: unknown; draft?: unknown; prerelease?: unknown }
  if (typeof release.tag_name !== 'string' || !parseVersion(release.tag_name) ||
      !parseVersion(currentVersion) || release.draft === true || release.prerelease === true) {
    return { status: 'error', message: '未找到有效的正式版本信息' }
  }
  const version = release.tag_name.replace(/^v/, '')
  return isNewerVersion(version, currentVersion)
    ? { status: 'available', version, url: RELEASES_URL }
    : { status: 'up-to-date', version }
}
