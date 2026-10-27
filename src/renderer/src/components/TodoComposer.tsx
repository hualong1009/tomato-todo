import { forwardRef, useEffect, useRef, useState } from 'react'
import { URGENCY_META } from '@shared/defaults'
import { formatBytes } from '@shared/attachments'
import type { AddTodoInput, Attachment, Group, Urgency } from '@shared/types'
import { fromDatetimeLocal, toDatetimeLocal } from '../utils/format'
import { fileToAttachment } from '../utils/attachmentFile'
import { Dropdown } from './Dropdown'
import { PaperclipIcon, PlusIcon, XIcon } from './Icons'
import { RichContentEditor } from './RichContentEditor'

interface TodoComposerProps {
  groups: Group[]
  defaultGroupId: string
  onAdd: (input: AddTodoInput) => Promise<boolean>
}

export const TodoComposer = forwardRef<HTMLInputElement, TodoComposerProps>(function TodoComposer(
  { groups, defaultGroupId, onAdd },
  ref
) {
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [attachError, setAttachError] = useState<string | null>(null)
  const [attachBusy, setAttachBusy] = useState(false)
  const [groupId, setGroupId] = useState(defaultGroupId)
  const [urgency, setUrgency] = useState<Urgency>('medium')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)
  const attachInputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (groups.some((group) => group.id === defaultGroupId)) setGroupId(defaultGroupId)
  }, [defaultGroupId, groups])

  const addAttachments = async (files: File[]) => {
    if (files.length === 0) return
    setAttachBusy(true)
    setAttachError(null)
    try {
      const added: Attachment[] = []
      for (const file of files) added.push(await fileToAttachment(file))
      setAttachments((current) => [...current, ...added])
    } catch (error) {
      setAttachError(error instanceof Error ? error.message : '添加附件失败')
    } finally {
      setAttachBusy(false)
    }
  }

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const ok = await onAdd({
        title: title.trim(),
        content,
        groupId,
        urgency,
        expectedAt: fromDatetimeLocal(expected),
        attachments: attachments.length > 0 ? attachments : undefined
      })
      if (ok) {
        setTitle('')
        setContent('')
        setAttachments([])
        setAttachError(null)
        setExpected('')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="composer" data-testid="composer">
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        <div className="composer-title-row">
          <span className="composer-plus">
            <PlusIcon size={18} />
          </span>
          <input
            ref={ref}
            className="composer-title"
            placeholder="添加一个待办…"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
            data-testid="composer-title"
          />
          <button className="btn primary composer-submit" type="submit" disabled={!title.trim() || busy} data-testid="composer-submit">
            添加
          </button>
        </div>
        <RichContentEditor
          compact
          value={content}
          placeholder="补充详细内容（可选，支持 Markdown，可直接粘贴或拖入图片）"
          onChange={setContent}
          onRequestSave={() => void submit()}
          onAttachFiles={(files) => void addAttachments(files)}
          data-testid="composer-content"
        />
        {attachments.length > 0 && (
          <ul className="attachment-list composer-attachments" data-testid="composer-attachments">
            {attachments.map((attachment) => (
              <li className="attachment-item" key={attachment.id}>
                <PaperclipIcon size={13} />
                <span className="attachment-name" title={attachment.name}>
                  {attachment.name}
                </span>
                <span className="attachment-size">{formatBytes(attachment.size)}</span>
                <button
                  type="button"
                  className="icon-btn tiny danger"
                  title="移除附件"
                  onClick={() =>
                    setAttachments((current) => current.filter((item) => item.id !== attachment.id))
                  }
                  data-testid={`composer-attachment-remove-${attachment.id}`}
                >
                  <XIcon size={11} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {attachError && <span className="composer-attach-error">{attachError}</span>}
        <div className="composer-meta">
          <label className="mini-field">
            <span>分组</span>
            <Dropdown
              size="mini"
              value={groupId}
              options={groups.map((group) => ({
                value: group.id,
                label: group.name,
                color: group.color
              }))}
              onChange={setGroupId}
              testId="composer-group"
            />
          </label>
          <label className="mini-field">
            <span>紧急程度</span>
            <Dropdown
              size="mini"
              value={urgency}
              options={(Object.keys(URGENCY_META) as Urgency[]).map((key) => ({
                value: key,
                label: URGENCY_META[key].label,
                color: URGENCY_META[key].color,
                short: URGENCY_META[key].short,
                description: URGENCY_META[key].description
              }))}
              onChange={(next) => setUrgency(next as Urgency)}
              testId="composer-urgency"
            />
          </label>
          <label className="mini-field">
            <span>期望完成</span>
            <input
              type="datetime-local"
              value={expected}
              min={toDatetimeLocal(new Date().toISOString())}
              onChange={(event) => setExpected(event.target.value)}
              data-testid="composer-expected"
            />
          </label>
          <span className="composer-hint">Ctrl + Enter 添加</span>
        </div>
      </form>
    </section>
  )
})
