import type { ReactNode } from 'react'
import {
  CloudCheckIcon,
  CloudIcon,
  CloudOffIcon,
  MinusIcon,
  SquareIcon,
  TomatoIcon,
  XIcon
} from './Icons'

interface TitleBarProps {
  maximized: boolean
  syncState: { enabled: boolean; status: 'idle' | 'success' | 'error'; lastSyncAt: string | null }
  miniTimer?: ReactNode
  onMinimize: () => void
  onToggleMaximize: () => void
  onClose: () => void
}

export function TitleBar({
  maximized,
  syncState,
  miniTimer,
  onMinimize,
  onToggleMaximize,
  onClose
}: TitleBarProps) {
  const cloudTitle = !syncState.enabled
    ? 'WebDAV 未启用'
    : syncState.status === 'success'
      ? `已同步${syncState.lastSyncAt ? ` · ${new Date(syncState.lastSyncAt).toLocaleTimeString()}` : ''}`
      : syncState.status === 'error'
        ? 'WebDAV 同步失败'
        : '等待同步'
  return (
    <header className="titlebar">
      <div className="titlebar-drag">
        <div className="brand">
          <span className="brand-mark">
            <TomatoIcon size={19} />
          </span>
          <span className="brand-name">番茄待办</span>
          <span className="brand-tag">FOCUS LIST</span>
        </div>
        <span className="titlebar-divider" />
        <span className={`sync-indicator ${syncState.enabled ? syncState.status : 'off'}`} title={cloudTitle}>
          {!syncState.enabled ? (
            <CloudOffIcon size={14} />
          ) : syncState.status === 'success' ? (
            <CloudCheckIcon size={14} />
          ) : (
            <CloudIcon size={14} />
          )}
          <span>{cloudTitle}</span>
        </span>
      </div>
      <div className="titlebar-right">
        {miniTimer}
        <span className="titlebar-hint">Ctrl+Shift+Space 唤起</span>
        <div className="window-controls">
          <button className="window-btn" onClick={onMinimize} title="最小化" data-testid="window-minimize">
            <MinusIcon size={15} />
          </button>
          <button
            className="window-btn"
            onClick={onToggleMaximize}
            title={maximized ? '还原' : '最大化'}
            data-testid="window-maximize"
          >
            {maximized ? <span className="restore-icon" /> : <SquareIcon size={13} />}
          </button>
          <button className="window-btn close" onClick={onClose} title="关闭" data-testid="window-close">
            <XIcon size={15} />
          </button>
        </div>
      </div>
    </header>
  )
}
