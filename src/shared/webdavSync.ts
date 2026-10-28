import { sha256 } from '@noble/hashes/sha256'
import { bytesToHex } from '@noble/hashes/utils'
import type { AppState, WebDAVSettings } from './types'

/** 定时双向同步的可选间隔（分钟），0 表示关闭定时同步。 */
export const SYNC_INTERVAL_OPTIONS = [0, 5, 15, 30, 60] as const

/** 默认间隔：5 分钟。WebDAV 已配置好的用户升级后即自动开始双向同步。 */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 5

/** 把任意输入归一到允许的间隔选项（非数字回退到默认 5 分钟）。 */
export function clampSyncInterval(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_SYNC_INTERVAL_MINUTES
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return DEFAULT_SYNC_INTERVAL_MINUTES
  if (parsed <= 0) return 0
  let best: number = SYNC_INTERVAL_OPTIONS[1]
  for (const option of SYNC_INTERVAL_OPTIONS) {
    if (option > 0 && Math.abs(option - parsed) < Math.abs(best - parsed)) best = option
  }
  return best
}

/**
 * 本机待办与分组的内容指纹（不含本机设置）。
 *
 * 与上次成功同步时记录的指纹比较，就能判断本机是否还有没上传的改动；
 * 这样即使应用被系统杀掉、上传没来得及完成，下次打开也能补传。
 */
/** 稳定序列化：键排序后再拼接，避免对象字段顺序不同导致指纹不一致。 */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

export function localFingerprint(state: Pick<AppState, 'groups' | 'todos'>): string {
  return bytesToHex(sha256(stableStringify({ groups: state.groups, todos: state.todos })))
}

export type WebDAVSyncAction = 'upload' | 'download' | 'none'

export interface WebDAVSyncDecision {
  action: WebDAVSyncAction
  /** 两端都有未同步改动，已按「本机优先」处理 */
  conflict: boolean
  reason: string
}

function timeValue(stamp: string | null | undefined): number {
  const parsed = stamp ? Date.parse(stamp) : NaN
  return Number.isFinite(parsed) ? parsed : 0
}

export interface WebDAVSyncInput {
  /** 当前本机数据指纹 */
  localHash: string
  /** 上次成功同步时记录的本机指纹 */
  lastSyncedHash: string | null | undefined
  /** 远端备份的 savedAt；null 表示远端还没有备份文件 */
  remoteSavedAt: string | null | undefined
  /** 上次成功同步时的远端 savedAt */
  lastRemoteSavedAt: string | null | undefined
  /** 上次成功同步的时间（老版本没有 lastSyncedHash 时用来判断谁更新） */
  lastSyncAt: string | null | undefined
}

/**
 * 决定这次同步该做什么：
 * - `upload`：本机有改动 → 上传（两端都改过时本机优先）
 * - `download`：本机没改、远端更新 → 拉取远端
 * - `none`：两边一致，无需传输
 */
export function decideWebDAVSync(input: WebDAVSyncInput): WebDAVSyncDecision {
  const remoteExists = Boolean(input.remoteSavedAt)
  const lastRemote = input.lastRemoteSavedAt ?? null
  const lastSyncedHash = input.lastSyncedHash ?? null

  if (!remoteExists) {
    return { action: 'upload', conflict: false, reason: '远端还没有备份，先上传本机数据' }
  }

  const remoteChanged = lastRemote
    ? input.remoteSavedAt !== lastRemote
    : // 没有同步记录（首次升级 / 新设备）：远端备份比上次本机同步更晚才算远端更新
      timeValue(input.remoteSavedAt) > timeValue(input.lastSyncAt) + 1000

  if (!lastSyncedHash) {
    // 没有内容指纹（老版本升级、新设备）：以时间较新的一方为准
    if (!input.lastSyncAt || remoteChanged) {
      return { action: 'download', conflict: Boolean(input.lastSyncAt), reason: '使用远端较新的备份' }
    }
    return { action: 'upload', conflict: false, reason: '本机数据不比远端旧，先上传本机数据' }
  }

  const localChanged = input.localHash !== lastSyncedHash
  if (localChanged && remoteChanged) {
    return { action: 'upload', conflict: true, reason: '本机与远端都有改动，保留本机数据并覆盖远端' }
  }
  if (localChanged) return { action: 'upload', conflict: false, reason: '本机有改动，上传到远端' }
  if (remoteChanged) return { action: 'download', conflict: false, reason: '远端有更新，拉取到本机' }
  return { action: 'none', conflict: false, reason: '已是最新' }
}

/** 定时同步是否启用（WebDAV 已启用且间隔 > 0）。 */
export function shouldAutoSync(settings: WebDAVSettings): boolean {
  return Boolean(settings.enabled && settings.url.trim() && settings.syncIntervalMinutes > 0)
}

/**
 * 改动后是否立即同步（保存、勾选完成、改分组…）。
 *
 * 与定时同步的开关相互独立：关掉定时同步只影响「定期去看看远端有没有新数据」，
 * 本机改完仍然会马上推上去，不会等到下次定时同步。
 */
export function shouldSyncOnChange(settings: WebDAVSettings): boolean {
  return Boolean(settings.enabled && settings.url.trim() && settings.autoUpload)
}
