/**
 * 同步状态文案：桌面标题栏与手机顶部栏共用。
 *
 * 放在 shared/ 里是因为不依赖任何浏览器 / Node API，可直接单测。
 */
export interface SyncIndicatorSource {
  enabled: boolean
  status: 'idle' | 'success' | 'error'
  lastSyncAt: string | null
  lastError?: string | null
}

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

function clockText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function fullText(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`
}

/** 同步状态短文案。 */
export function syncStatusLabel(sync: SyncIndicatorSource): string {
  if (!sync.enabled) return 'WebDAV 未启用'
  if (sync.status === 'error') return '同步失败'
  if (!sync.lastSyncAt) return '等待同步'
  return `已同步 · ${clockText(sync.lastSyncAt)}`
}

/** 同步状态详情：悬浮 / 长按提示用的完整说明。 */
export function syncStatusDetail(sync: SyncIndicatorSource): string {
  if (!sync.enabled) return 'WebDAV 未启用，去设置里填写地址后即可自动同步'
  if (sync.status === 'error') {
    return `上次同步失败${sync.lastError ? `：${sync.lastError}` : ''}，点击可重试`
  }
  if (!sync.lastSyncAt) return '还没有同步过，点击立即同步'
  return `上次同步：${fullText(sync.lastSyncAt)}，点击立即同步`
}
