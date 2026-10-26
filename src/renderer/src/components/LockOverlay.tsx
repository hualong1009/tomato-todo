import { useEffect, useRef, useState } from 'react'
import { cleanError } from '../utils/format'
import { LockIcon, TomatoIcon } from './Icons'

/** 全屏锁定遮罩：应用锁定后覆盖所有界面，输入管理员密码解锁。 */
export function LockOverlay() {
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const unlock = async () => {
    if (busy) return
    if (!password) {
      setError('请输入管理员密码')
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    setError(null)
    try {
      const result = await window.api.unlock(password)
      if (!result.ok) {
        setError(result.message ?? '密码不正确')
        inputRef.current?.focus()
        inputRef.current?.select()
      }
      // 解锁成功时 security:changed 事件会让本组件卸载
    } catch (cause) {
      setError(cleanError(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock-overlay" data-testid="lock-overlay">
      <div className="lock-card" role="dialog" aria-modal="true" aria-label="应用已锁定">
        <div className="lock-brand">
          <TomatoIcon size={30} />
        </div>
        <div className="lock-mark">
          <LockIcon size={26} />
        </div>
        <h2>应用已锁定</h2>
        <p>空闲自动锁定已触发，输入管理员密码继续。</p>
        <input
          ref={inputRef}
          type="password"
          value={password}
          placeholder="管理员密码"
          onChange={(event) => {
            setPassword(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void unlock()
          }}
          data-testid="lock-password"
        />
        {error && (
          <p className="lock-error" data-testid="lock-error">
            {error}
          </p>
        )}
        <button
          className="btn primary"
          onClick={() => void unlock()}
          disabled={busy || !password}
          data-testid="lock-unlock"
        >
          {busy ? <span className="spinner" /> : <LockIcon size={15} />}
          {busy ? '验证中…' : '解锁'}
        </button>
      </div>
    </div>
  )
}
