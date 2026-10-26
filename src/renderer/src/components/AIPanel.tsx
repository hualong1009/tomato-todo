import { useEffect, useMemo, useState } from 'react'
import { RANGE_LABELS, buildSummaryContext } from '@shared/summary'
import type { AIRequestResult, AppState, SummaryRange } from '@shared/types'
import { cleanError, formatDateTime } from '../utils/format'
import { Markdown } from './Markdown'
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  SettingsIcon,
  SparklesIcon,
  TimerIcon,
  XIcon
} from './Icons'

interface AIPanelProps {
  open: boolean
  state: AppState
  onClose: () => void
  onOpenSettings: () => void
  onToast: (message: string, tone?: 'info' | 'success' | 'error') => void
}

export function AIPanel({ open, state, onClose, onOpenSettings, onToast }: AIPanelProps) {
  const [range, setRange] = useState<SummaryRange>('week')
  const [results, setResults] = useState<Partial<Record<SummaryRange, AIRequestResult>>>({})
  const [loading, setLoading] = useState<SummaryRange | null>(null)
  const context = useMemo(() => buildSummaryContext(state, range), [state, range])
  const result = results[range]
  const configured = Boolean(state.settings.ai.apiKey && state.settings.ai.baseUrl && state.settings.ai.model)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loading) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, loading, onClose])

  const generate = async () => {
    if (loading) return
    setLoading(range)
    try {
      const response = await window.api.summarise(range)
      setResults((previous) => ({ ...previous, [range]: response }))
      if (!response.ok) onToast(response.error ?? '生成失败', 'error')
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setLoading(null)
    }
  }

  if (!open) return null
  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onClose()
      }}
    >
      <aside className="ai-panel" data-testid="ai-panel">
        <header className="ai-header">
          <div className="ai-title">
            <span className="ai-orb">
              <SparklesIcon size={21} />
            </span>
            <div>
              <h2>AI 回顾</h2>
              <p>让 AI 帮你看见执行节奏与阻塞点</p>
            </div>
          </div>
          <button className="icon-btn" onClick={onClose} disabled={Boolean(loading)} aria-label="关闭" data-testid="ai-close">
            <XIcon />
          </button>
        </header>

        <div className="range-tabs">
          {(['week', 'month', 'year'] as SummaryRange[]).map((item) => (
            <button
              key={item}
              className={item === range ? 'active' : ''}
              onClick={() => setRange(item)}
              data-testid={`ai-range-${item}`}
            >
              {RANGE_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="ai-stats">
          <div className="ai-stat">
            <span>范围待办</span>
            <strong>{context.total}</strong>
          </div>
          <div className="ai-stat">
            <span>完成率</span>
            <strong>{context.completionRate}</strong>
          </div>
          <div className="ai-stat">
            <span>进行中</span>
            <strong>{context.inProgressCount}</strong>
          </div>
          <div className="ai-stat warn">
            <span>未完成</span>
            <strong>{context.overdueCount}</strong>
          </div>
          <div className="ai-stat focus">
            <span>专注分钟</span>
            <strong>{context.focusMinutes}</strong>
          </div>
        </div>

        <div className="ai-range-note">
          {context.rangeStart} — {context.rangeEnd} · 已归档事项不会进入 AI 数据
        </div>

        <div className="ai-body">
          {!configured && (
            <div className="ai-config-warning">
              <AlertIcon size={18} />
              <div>
                <strong>还没有配置 AI 接口</strong>
                <p>支持 OpenAI / Anthropic 兼容端点，可在设置中填写 Base URL、密钥和模型。</p>
                <button className="btn primary small" onClick={onOpenSettings}>
                  <SettingsIcon size={14} />
                  去配置
                </button>
              </div>
            </div>
          )}

          {result?.ok && result.content ? (
            <div className="ai-result" data-testid="ai-output">
              <div className="ai-result-meta">
                <span>
                  <CheckIcon size={13} />
                  {result.model ?? state.settings.ai.model}
                </span>
                <span>{formatDateTime(result.generatedAt)}</span>
                <div className="ai-result-tools">
                  <button
                    className="tiny-btn"
                    title="复制"
                    onClick={() => {
                      void window.api.copyText(result.content ?? '')
                      onToast('已复制总结', 'success')
                    }}
                  >
                    <CopyIcon size={15} />
                  </button>
                </div>
              </div>
              <Markdown content={result.content} />
            </div>
          ) : result && !result.ok ? (
            <div className="ai-error">
              <AlertIcon size={18} />
              <div>
                <strong>生成失败</strong>
                <p>{result.error}</p>
              </div>
            </div>
          ) : (
            <div className="ai-placeholder">
              <div className="ai-scan">
                <span />
                <span />
                <SparklesIcon size={34} />
              </div>
              <h3>生成「{RANGE_LABELS[range]}」执行总结</h3>
              <p>
                将基于 {context.total} 条待办、紧急程度、期望/实际完成时间和专注记录生成回顾。模板可在设置中随时修改。
              </p>
            </div>
          )}
        </div>

        <footer className="ai-footer">
          <button className="btn ghost" onClick={onOpenSettings}>
            <SettingsIcon size={14} />
            提示词模板
          </button>
          <button
            className="btn ai-generate"
            onClick={() => void generate()}
            disabled={Boolean(loading) || !configured}
            data-testid="ai-generate"
          >
            {loading ? (
              <>
                <span className="spinner" />
                AI 正在整理…
              </>
            ) : (
              <>
                <SparklesIcon size={16} />
                {result?.ok ? '重新生成' : '生成总结'}
              </>
            )}
          </button>
        </footer>
        {loading && (
          <div className="ai-loading-bar">
            <TimerIcon size={14} />
            正在分析数据并生成 Markdown 回顾…
          </div>
        )}
      </aside>
    </div>
  )
}
