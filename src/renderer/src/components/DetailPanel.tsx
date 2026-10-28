import { useEffect, useRef, useState } from 'react'
import { STICKY_COLORS, URGENCY_META } from '@shared/defaults'
import type { AppState, Attachment, Todo, UpdateTodoPatch, Urgency } from '@shared/types'
import { formatBytes } from '@shared/attachments'
import { fileToAttachment } from '../utils/attachmentFile'
import { isMobile } from '../platform'
import { useBackDismiss } from '../platform/backNavigation'
import { getTodoStatus, STATUS_META } from '@shared/todoUtils'
import {
  formatDateTime,
  formatFullDateTime,
  fromDatetimeLocal,
  toDatetimeLocal,
  todoStatusText
} from '../utils/format'
import {
  ArchiveIcon,
  CalendarIcon,
  CheckIcon,
  ClockIcon,
  DownloadIcon,
  PaperclipIcon,
  PaletteIcon,
  PencilIcon,
  PinIcon,
  PlayIcon,
  ResetIcon,
  TimerIcon,
  TrashIcon,
  XIcon
} from './Icons'
import { Dropdown } from './Dropdown'
import { Markdown } from './Markdown'
import { RichContentEditor } from './RichContentEditor'

interface DetailPanelProps {
  todo: Todo
  state: AppState
  now: number
  onClose: () => void
  onUpdate: (id: string, patch: UpdateTodoPatch) => Promise<boolean>
  onToggle: (todo: Todo, completed: boolean) => void
  onStart: (todo: Todo) => void
  onPin: (todo: Todo) => void
  onPomodoro: (todo: Todo) => void
  onArchive: (todo: Todo) => void
  onRestore: (todo: Todo) => void
  onDeleteForever: (todo: Todo) => void
}

export function DetailPanel({
  todo,
  state,
  now,
  onClose,
  onUpdate,
  onToggle,
  onStart,
  onPin,
  onPomodoro,
  onArchive,
  onRestore,
  onDeleteForever
}: DetailPanelProps) {
  const [title, setTitle] = useState(todo.title)
  const [content, setContent] = useState(todo.content)
  const [expected, setExpected] = useState(toDatetimeLocal(todo.expectedAt))
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [attachments, setAttachments] = useState<Attachment[]>(todo.attachments)
  const [attachBusy, setAttachBusy] = useState(false)
  const [attachError, setAttachError] = useState<string | null>(null)
  const attachInputRef = useRef<HTMLInputElement | null>(null)
  /** 详情面板默认是只读预览，点编辑图标才进入编辑态，编辑完需手动保存。 */
  const [editing, setEditing] = useState(false)
  const todoRef = useRef(todo)
  todoRef.current = todo
  const archived = Boolean(todo.archivedAt)
  const completed = Boolean(todo.completedAt)
  const status = getTodoStatus(todo, now)
  const group = state.groups.find((item) => item.id === todo.groupId)
  /** 附件只比较标识与体积，避免对大段 base64 做深比较。 */
  const attachmentKey = (list: Attachment[]): string =>
    list.map((item) => `${item.id}:${item.name}:${item.size}`).join('|')
  const dirty =
    title !== todo.title ||
    content !== todo.content ||
    attachmentKey(attachments) !== attachmentKey(todo.attachments)

  useEffect(() => {
    setTitle(todo.title)
    setContent(todo.content)
    setAttachments(todo.attachments)
    setAttachError(null)
    setExpected(toDatetimeLocal(todo.expectedAt))
    setSaveState('saved')
    setEditing(false)
  }, [todo.id])

  const startEditing = () => {
    if (archived) return
    setTitle(todo.title)
    setContent(todo.content)
    setAttachments(todo.attachments)
    setAttachError(null)
    setSaveState('saved')
    setEditing(true)
  }

  const cancelEditing = () => {
    setTitle(todo.title)
    setContent(todo.content)
    setAttachments(todo.attachments)
    setAttachError(null)
    setSaveState('saved')
    setEditing(false)
  }

  const addAttachments = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (list.length === 0) return
    setAttachBusy(true)
    setAttachError(null)
    try {
      const added: Attachment[] = []
      for (const file of list) added.push(await fileToAttachment(file))
      setAttachments((current) => [...current, ...added])
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : '添加附件失败')
    } finally {
      setAttachBusy(false)
      if (attachInputRef.current) attachInputRef.current.value = ''
    }
  }

  const downloadAttachment = async (attachment: Attachment) => {
    const result = await window.api.saveAttachment({ name: attachment.name, dataUrl: attachment.data })
    if (!result.ok) setAttachError(result.message)
    else setAttachError(null)
  }

  const saveEditing = async () => {
    const nextTitle = title.trim()
    if (!nextTitle) return
    if (!dirty) {
      setEditing(false)
      return
    }
    setSaveState('saving')
    const ok = await onUpdate(todo.id, { title: nextTitle, content, attachments })
    if (ok) {
      setTitle(nextTitle)
      setSaveState('saved')
      setEditing(false)
    } else {
      setSaveState('error')
    }
  }

  const requestClose = () => {
    if (editing && dirty && !window.confirm('详细内容还没保存，确定放弃修改并关闭吗？')) return
    setEditing(false)
    onClose()
  }

  // 手机端返回键和面板上的关闭按钮走同一套逻辑（编辑中会先确认）
  useBackDismiss(true, requestClose)

  // 编辑态支持 Ctrl+S 保存、Esc 取消
  useEffect(() => {
    if (!editing) return
    const handler = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void saveEditing()
      } else if (event.key === 'Escape') {
        event.preventDefault()
        cancelEditing()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const patch = async (value: UpdateTodoPatch) => {
    const ok = await onUpdate(todo.id, value)
    if (ok) setSaveState('saved')
  }

  return (
    <aside className="detail-panel" data-testid="detail-panel">
      <header className="detail-header">
        <div className="detail-header-left">
          <span className="detail-eyebrow">TASK DETAIL</span>
          <span
            className={`chip chip-status status-${status}`}
            style={{ color: STATUS_META[status].color }}
          >
            <i className="chip-dot" style={{ background: STATUS_META[status].color }} />
            {todoStatusText(todo, now)}
          </span>
        </div>
        <div className="detail-header-actions">
          {!archived && !editing && (
            <button
              className="icon-btn"
              onClick={startEditing}
              aria-label="编辑详细内容"
              title="编辑详细内容"
              data-testid="detail-edit"
            >
              <PencilIcon size={16} />
            </button>
          )}
          <button className="icon-btn" onClick={requestClose} aria-label="关闭详情" data-testid="detail-close">
            <XIcon />
          </button>
        </div>
      </header>

      <div className="detail-scroll">
        <div className={`detail-check-wrap ${archived ? 'disabled' : ''}`}>
          <button
            className={`detail-check ${completed ? 'checked' : ''}`}
            onClick={() => !archived && onToggle(todo, !completed)}
            role="checkbox"
            aria-checked={completed}
            data-testid="detail-check"
          >
            <CheckIcon size={16} />
          </button>
          <div>
            <strong>{completed ? '已完成' : '标记为已完成'}</strong>
            <span>
              {completed
                ? `实际完成时间 ${formatFullDateTime(todo.completedAt)}`
                : '勾选后会记录实际完成时间'}
            </span>
          </div>
        </div>

        {editing ? (
          <>
            <input
              className="detail-title-input"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="待办标题"
              data-testid="detail-title"
            />
            <RichContentEditor
              value={content}
              placeholder="写下详细内容、背景、拆分步骤…支持 Markdown 与图片"
              onChange={setContent}
              onRequestSave={() => void saveEditing()}
              onRequestCancel={cancelEditing}
            />
            <div className="detail-edit-bar">
              <button
                className="btn primary"
                onClick={() => void saveEditing()}
                disabled={saveState === 'saving' || !title.trim()}
                data-testid="detail-save"
              >
                <CheckIcon size={14} />
                {saveState === 'saving' ? '保存中…' : '保存'}
              </button>
              <button className="btn ghost" onClick={cancelEditing} data-testid="detail-cancel">
                取消
              </button>
              <span className="save-state">
                {saveState === 'saving'
                  ? '正在保存…'
                  : saveState === 'error'
                    ? '保存失败，请重试'
                    : dirty
                      ? '有未保存的修改 · Ctrl+S 保存、Esc 取消'
                      : '暂无修改'}
              </span>
            </div>

            <div className="detail-attachments" data-testid="detail-attachments">
              <div className="section-mini-title">
                <PaperclipIcon size={14} />
                附件
                <span className="muted">· {attachments.length} 个</span>
                <button
                  type="button"
                  className="btn ghost attach-add"
                  onClick={() => attachInputRef.current?.click()}
                  disabled={attachBusy}
                  data-testid="attachment-add"
                >
                  {attachBusy ? '添加中…' : '添加附件'}
                </button>
              </div>
              {attachments.length === 0 ? (
                <p className="detail-hint">可添加文档、压缩包、图片等任意文件，保存后随备份一起导出。</p>
              ) : (
                <ul className="attachment-list">
                  {attachments.map((attachment) => (
                    <li key={attachment.id} className="attachment-item" data-testid="attachment-item">
                      <PaperclipIcon size={13} />
                      <span className="attachment-name" title={attachment.name}>
                        {attachment.name}
                      </span>
                      <span className="attachment-size">{formatBytes(attachment.size)}</span>
                      <button
                        type="button"
                        className="icon-btn tiny"
                        title="下载附件"
                        onClick={() => void downloadAttachment(attachment)}
                        data-testid="attachment-download"
                      >
                        <DownloadIcon size={14} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn tiny danger"
                        title="删除附件"
                        onClick={() =>
                          setAttachments((current) => current.filter((item) => item.id !== attachment.id))
                        }
                        data-testid="attachment-remove"
                      >
                        <TrashIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <input
                ref={attachInputRef}
                type="file"
                multiple
                hidden
                onChange={(event) => void addAttachments(event.target.files)}
                data-testid="attachment-input"
              />
              {attachError && <span className="rich-hint error">{attachError}</span>}
            </div>
          </>
        ) : (
          <>
            <h2 className="detail-title-view" data-testid="detail-title-view">
              {todo.title || '未命名待办'}
            </h2>
            <div className="detail-content-view" data-testid="detail-content-view">
              {todo.content.trim() ? (
                <Markdown content={todo.content} />
              ) : (
                <p className="detail-content-empty">暂无详细内容，点右上角铅笔图标开始编辑。</p>
              )}
            </div>
            {todo.attachments.length > 0 && (
              <div className="detail-attachments" data-testid="detail-attachments-view">
                <div className="section-mini-title">
                  <PaperclipIcon size={14} />
                  附件
                  <span className="muted">· {todo.attachments.length} 个</span>
                </div>
                <ul className="attachment-list">
                  {todo.attachments.map((attachment) => (
                    <li key={attachment.id} className="attachment-item" data-testid="attachment-item">
                      <PaperclipIcon size={13} />
                      <span className="attachment-name" title={attachment.name}>
                        {attachment.name}
                      </span>
                      <span className="attachment-size">{formatBytes(attachment.size)}</span>
                      <button
                        type="button"
                        className="icon-btn tiny"
                        title="下载附件"
                        onClick={() => void downloadAttachment(attachment)}
                        data-testid="attachment-download"
                      >
                        <DownloadIcon size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
                {attachError && <span className="rich-hint error">{attachError}</span>}
              </div>
            )}
          </>
        )}

        <div className="detail-actions">
          {!archived && !completed && (
            <>
              {!todo.startedAt && (
                <button className="btn primary" onClick={() => onStart(todo)} data-testid="detail-start">
                  <PlayIcon size={13} />
                  开始任务
                </button>
              )}
              <button className="btn tomato" onClick={() => onPomodoro(todo)} data-testid="detail-pomodoro">
                <TimerIcon size={15} />
                番茄专注
              </button>
            </>
          )}
          {!isMobile && !archived && (
            <button
              className={`btn ghost ${todo.pinned ? 'active' : ''}`}
              onClick={() => onPin(todo)}
              data-testid="detail-pin"
            >
              <PinIcon size={15} filled={todo.pinned} />
              {todo.pinned ? '取消便签' : '固定便签'}
            </button>
          )}
          {archived ? (
            <>
              <button className="btn ghost" onClick={() => onRestore(todo)} data-testid="detail-restore">
                <ResetIcon size={15} />
                恢复
              </button>
              <button
                className="btn danger"
                onClick={() => onDeleteForever(todo)}
                data-testid="detail-delete-forever"
              >
                <TrashIcon size={15} />
                永久删除
              </button>
            </>
          ) : (
            <button className="btn ghost" onClick={() => onArchive(todo)} data-testid="detail-archive">
              <ArchiveIcon size={15} />
              归档
            </button>
          )}
        </div>

        <div className="detail-grid">
          <label className="field">
            <span>所属分组</span>
            <Dropdown
              value={todo.groupId}
              disabled={archived}
              options={state.groups.map((item) => ({
                value: item.id,
                label: item.name,
                color: item.color
              }))}
              onChange={(next) => void patch({ groupId: next })}
              testId="detail-group"
            />
          </label>
          <label className="field">
            <span>紧急程度</span>
            <Dropdown
              value={todo.urgency}
              disabled={archived}
              options={(Object.keys(URGENCY_META) as Urgency[]).map((key) => ({
                value: key,
                label: URGENCY_META[key].label,
                color: URGENCY_META[key].color,
                short: URGENCY_META[key].short,
                description: URGENCY_META[key].description
              }))}
              onChange={(next) => void patch({ urgency: next as Urgency })}
              testId="detail-urgency"
            />
          </label>
          <label className="field field-wide">
            <span>期望完成时间</span>
            <input
              type="datetime-local"
              value={expected}
              disabled={archived}
              onChange={(event) => {
                setExpected(event.target.value)
                void patch({ expectedAt: fromDatetimeLocal(event.target.value) })
              }}
              data-testid="detail-expected"
            />
          </label>
        </div>

        <div className="detail-timeline">
          <div className="timeline-item">
            <ClockIcon size={14} />
            <span>创建</span>
            <strong>{formatDateTime(todo.createdAt)}</strong>
          </div>
          <div className="timeline-item">
            <PlayIcon size={12} />
            <span>实际开始</span>
            <strong>{formatDateTime(todo.startedAt)}</strong>
          </div>
          <div className="timeline-item">
            <CheckIcon size={14} />
            <span>实际完成</span>
            <strong>{formatDateTime(todo.completedAt)}</strong>
          </div>
          <div className="timeline-item">
            <ArchiveIcon size={14} />
            <span>归档</span>
            <strong>{formatDateTime(todo.archivedAt)}</strong>
          </div>
          <div className="timeline-item">
            <TimerIcon size={14} />
            <span>番茄 / 专注</span>
            <strong>
              {todo.pomodoroCount} 次 · {todo.focusMinutes} 分钟
            </strong>
          </div>
        </div>

        {!isMobile && (
          <div className="detail-note-style">
            <div className="section-mini-title">
              <PaletteIcon size={15} />
              桌面便签样式
              {group && <span className="muted">· {group.name}</span>}
            </div>
            <div className="swatch-row">
              {STICKY_COLORS.map((color) => (
                <button
                  key={color}
                  className={`swatch ${todo.stickyColor === color ? 'selected' : ''}`}
                  style={{ background: color }}
                  onClick={() => void patch({ stickyColor: color })}
                  title={color}
                  disabled={archived}
                />
              ))}
            </div>
            <label className="opacity-field">
              <span>透明度</span>
              <input
                type="range"
                min="25"
                max="100"
                value={Math.round(todo.stickyOpacity * 100)}
                disabled={archived}
                onChange={(event) => void patch({ stickyOpacity: Number(event.target.value) / 100 })}
              />
              <strong>{Math.round(todo.stickyOpacity * 100)}%</strong>
            </label>
            <p className="detail-hint">每个便签独立保存背景颜色和透明度。</p>
          </div>
        )}
      </div>
    </aside>
  )
}
