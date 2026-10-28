import { useEffect, useMemo, useState } from 'react'
import { RANGE_LABELS, buildSummaryContext } from '@shared/summary'
import { listPromptTemplates } from '@shared/promptTemplates'
import type { AIRequestResult, AppState, SummaryDates, SummaryRange } from '@shared/types'
import { useBackDismiss } from '../platform/backNavigation'
import { cleanError, formatDateTime } from '../utils/format'
import { Markdown } from './Markdown'
import {
  AlertIcon,
  CheckIcon,
  CopyIcon,
  PencilIcon,
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

const RANGE_TABS: SummaryRange[] = ['day', 'week', 'month', 'year', 'custom']

function toDateInput(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function AIPanel({ open, state, onClose, onOpenSettings, onToast }: AIPanelProps) {
  const [range, setRange] = useState<SummaryRange>('week')
  const [dates, setDates] = useState<SummaryDates>(() => {
    const today = new Date()
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6)
    return { start: toDateInput(start), end: toDateInput(today) }
  })
  const [results, setResults] = useState<Partial<Record<string, AIRequestResult>>>({})
  const [loading, setLoading] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  // 同一个范围（自定义范围还包含起止日期）对应一份结果，切换日期不会丢之前的总结
  const rangeKey = range === 'custom' ? `custom:${dates.start}~${dates.end}` : range
  const context = useMemo(() => {
    try {
      return {
        data: buildSummaryContext(state, range, Date.now(), range === 'custom' ? dates : undefined),
        error: null as string | null
      }
    } catch (error) {
      return { data: null, error: error instanceof Error ? error.message : '日期范围不合法' }
    }
  }, [state, range, dates])
  const result = results[rangeKey]
  const templates = listPromptTemplates(state.settings)
  const activeTemplateId = state.settings.activePromptTemplateId

  const selectTemplate = (id: string) => {
    const template = templates.find((item) => item.id === id)
    if (!template) return
    // 记住上次选择：promptTemplate 是旧字段镜像，保持与选中模板内容一致
    void window.api
      .updateSettings({ activePromptTemplateId: id, promptTemplate: template.content })
      .catch(() => undefined)
  }
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
    if (context.error) {
      onToast(context.error, 'error')
      return
    }
    setLoading(rangeKey)
    setEditing(false)
    try {
      const response = await window.api.summarise(range, range === 'custom' ? dates : undefined)
      setResults((previous) => ({ ...previous, [rangeKey]: response }))
      if (!response.ok) onToast(response.error ?? '生成失败', 'error')
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setLoading(null)
    }
  }

  const startEdit = () => {
    setDraft(result?.content ?? '')
    setEditing(true)
  }

  const saveEdit = () => {
    const current = results[rangeKey]
    if (!current?.ok) return
    setResults((previous) => ({
      ...previous,
      [rangeKey]: { ...current, content: draft }
    }))
    setEditing(false)
    onToast('已保存修改', 'success')
  }

  // 手机端返回键关闭回顾抽屉；生成中不关闭，避免丢失请求结果
  useBackDismiss(open, () => {
    if (!loading) onClose()
  })

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
          {RANGE_TABS.map((item) => (
            <button
              key={item}
              className={item === range ? 'active' : ''}
              onClick={() => {
                setRange(item)
                setEditing(false)
              }}
              data-testid={`ai-range-${item}`}
            >
              {RANGE_LABELS[item]}
            </button>
          ))}
        </div>

        <div className="ai-template-row">
          <label className="ai-template-select">
            <span>输出模板</span>
            <select
              value={activeTemplateId}
              onChange={(event) => selectTemplate(event.target.value)}
              data-testid="ai-template-select"
            >
              {templates.map((template) => (
                <option key={template.id} value={template.id}>
                  {template.name}
                  {template.builtin ? '（内置）' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {range === 'custom' && (
          <div className="ai-custom-range" data-testid="ai-custom-range">
            <label>
              <span>开始日期</span>
              <input
                type="date"
                value={dates.start}
                max={dates.end}
                onChange={(event) => setDates((previous) => ({ ...previous, start: event.target.value }))}
                data-testid="ai-date-start"
              />
            </label>
            <span className="ai-custom-sep">至</span>
            <label>
              <span>结束日期</span>
              <input
                type="date"
                value={dates.end}
                min={dates.start}
                onChange={(event) => setDates((previous) => ({ ...previous, end: event.target.value }))}
                data-testid="ai-date-end"
              />
            </label>
          </div>
        )}

        <div className="ai-stats">
          {context.data ? (
            <>
              <div className="ai-stat">
                <span>范围待办</span>
                <strong>{context.data.total}</strong>
              </div>
              <div className="ai-stat">
                <span>完成率</span>
                <strong>{context.data.completionRate}</strong>
              </div>
              <div className="ai-stat">
                <span>进行中</span>
                <strong>{context.data.inProgressCount}</strong>
              </div>
              <div className="ai-stat warn">
                <span>未完成</span>
                <strong>{context.data.overdueCount}</strong>
              </div>
              <div className="ai-stat focus">
                <span>专注分钟</span>
                <strong>{context.data.focusMinutes}</strong>
              </div>
            </>
          ) : (
            <div className="ai-stat">
              <span>日期范围</span>
              <strong>—</strong>
            </div>
          )}
        </div>

        <div className="ai-range-note">
          {context.data
            ? `${context.data.rangeStart} — ${context.data.rangeEnd} · 已归档事项不会进入 AI 数据`
            : '请选择合法的日期范围'}
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
                  {editing ? (
                    <>
                      <button
                        className="tiny-btn primary"
                        title="保存修改"
                        onClick={saveEdit}
                        disabled={!draft.trim()}
                        data-testid="ai-save"
                      >
                        <CheckIcon size={15} />
                      </button>
                      <button
                        className="tiny-btn"
                        title="取消编辑"
                        onClick={() => setEditing(false)}
                        data-testid="ai-cancel"
                      >
                        <XIcon size={15} />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        className="tiny-btn"
                        title="复制全文"
                        onClick={() => {
                          void window.api.copyText(result.content ?? '')
                          onToast('已复制总结', 'success')
                        }}
                        data-testid="ai-copy"
                      >
                        <CopyIcon size={15} />
                      </button>
                      <button
                        className="tiny-btn"
                        title="编辑内容"
                        onClick={startEdit}
                        data-testid="ai-edit"
                      >
                        <PencilIcon size={15} />
                      </button>
                    </>
                  )}
                </div>
              </div>
              {editing ? (
                <textarea
                  className="ai-edit-area"
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  spellCheck={false}
                  data-testid="ai-edit-area"
                />
              ) : (
                <Markdown content={result.content} />
              )}
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
              <h3>
                生成「
                {range === 'custom'
                  ? dates.start === dates.end
                    ? dates.start
                    : `${dates.start} ~ ${dates.end}`
                  : RANGE_LABELS[range]}
                」执行总结
              </h3>
              <p>
                将基于 {context.data?.total ?? 0} 条待办、紧急程度、期望/实际完成时间和专注记录生成回顾。模板可在设置中随时修改。
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
            disabled={Boolean(loading) || !configured || Boolean(context.error)}
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
