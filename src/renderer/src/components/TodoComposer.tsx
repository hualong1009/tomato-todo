import { forwardRef, useEffect, useState } from 'react'
import { URGENCY_META } from '@shared/defaults'
import type { AddTodoInput, Group, Urgency } from '@shared/types'
import { fromDatetimeLocal, toDatetimeLocal } from '../utils/format'
import { PlusIcon } from './Icons'
import { Dropdown } from './Dropdown'

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
  const [groupId, setGroupId] = useState(defaultGroupId)
  const [urgency, setUrgency] = useState<Urgency>('medium')
  const [expected, setExpected] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (groups.some((group) => group.id === defaultGroupId)) setGroupId(defaultGroupId)
  }, [defaultGroupId, groups])

  const submit = async () => {
    if (!title.trim() || busy) return
    setBusy(true)
    try {
      const ok = await onAdd({
        title: title.trim(),
        content,
        groupId,
        urgency,
        expectedAt: fromDatetimeLocal(expected)
      })
      if (ok) {
        setTitle('')
        setContent('')
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
        <textarea
          className="composer-content"
          placeholder="补充详细内容（可选）"
          value={content}
          rows={2}
          onChange={(event) => setContent(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
              event.preventDefault()
              void submit()
            }
          }}
          data-testid="composer-content"
        />
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
