import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CONTENT_MAX_CHARS, CONTENT_TEXT_LIMIT, contentTextLength } from '@shared/content'
import { Markdown } from './Markdown'
import {
  BoldIcon,
  CodeIcon,
  EyeIcon,
  HeadingIcon,
  ImageIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  PaperclipIcon,
  QuoteIcon,
  StrikeIcon,
  TrashIcon
} from './Icons'

export interface RichContentEditorProps {
  value: string
  disabled?: boolean
  placeholder?: string
  onChange: (value: string) => void
  /** Ctrl+S / Ctrl+Enter 触发（由外层负责保存） */
  onRequestSave?: () => void
  /** Esc 触发（由外层负责取消） */
  onRequestCancel?: () => void
  /** 紧凑模式：仅保留插入图片/附件入口，隐藏格式工具与视图切换 */
  compact?: boolean
  /** 紧凑模式下的附件入口：文件交给外层处理（附件不写入正文） */
  onAttachFiles?: (files: File[]) => void
  /** 测试用属性透传 */
  'data-testid'?: string
}

const MAX_IMAGE_WIDTH = 1280
const MAX_IMAGE_BYTES = 6 * 1024 * 1024

type Mode = 'edit' | 'split' | 'preview'

/** 把图片压缩成限制宽度的 WebP/PNG data URL，控制正文体积。 */
async function compressImage(file: File): Promise<string> {
  if (file.size > MAX_IMAGE_BYTES) throw new Error('图片超过 6MB，请压缩后再插入')
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('图片读取失败'))
    reader.readAsDataURL(file)
  })
  if (file.type === 'image/svg+xml') return dataUrl

  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const element = new Image()
    element.onload = () => resolve(element)
    element.onerror = () => reject(new Error('图片解码失败'))
    element.src = dataUrl
  })
  const scale = Math.min(1, MAX_IMAGE_WIDTH / (image.naturalWidth || MAX_IMAGE_WIDTH))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round((image.naturalWidth || MAX_IMAGE_WIDTH) * scale)
  canvas.height = Math.round((image.naturalHeight || MAX_IMAGE_WIDTH) * scale)
  const context = canvas.getContext('2d')
  if (!context) return dataUrl
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  const compressed = canvas.toDataURL('image/webp', 0.82)
  return compressed.startsWith('data:image/webp') ? compressed : canvas.toDataURL('image/png')
}

const TOOLS = [
  { id: 'bold', label: '加粗 (Ctrl+B)', icon: BoldIcon },
  { id: 'italic', label: '斜体 (Ctrl+I)', icon: ItalicIcon },
  { id: 'strike', label: '删除线', icon: StrikeIcon },
  { id: 'heading', label: '标题', icon: HeadingIcon },
  { id: 'list', label: '无序列表', icon: ListIcon },
  { id: 'quote', label: '引用', icon: QuoteIcon },
  { id: 'code', label: '行内代码', icon: CodeIcon },
  { id: 'link', label: '链接 (Ctrl+K)', icon: LinkIcon }
] as const

export function RichContentEditor({
  value,
  disabled,
  placeholder,
  onChange,
  onRequestSave,
  onRequestCancel,
  compact = false,
  onAttachFiles,
  'data-testid': testId = 'detail-content'
}: RichContentEditorProps) {
  const [mode, setMode] = useState<Mode>('edit')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const attachRef = useRef<HTMLInputElement | null>(null)
  const pendingSelection = useRef<{ start: number; end: number } | null>(null)

  const hasContent = value.trim().length > 0

  const applyChange = useCallback(
    (next: string, selection?: { start: number; end: number }) => {
      onChange(next)
      pendingSelection.current = selection ?? null
    },
    [onChange]
  )

  // 插入文本后恢复光标位置（受控组件会重置 selection）
  useEffect(() => {
    const selection = pendingSelection.current
    if (!selection || !textareaRef.current) return
    pendingSelection.current = null
    const element = textareaRef.current
    element.focus()
    element.setSelectionRange(selection.start, selection.end)
  }, [value])

  const wrapSelection = (before: string, after = before) => {
    const element = textareaRef.current
    const start = element?.selectionStart ?? value.length
    const end = element?.selectionEnd ?? value.length
    const selected = value.slice(start, end)
    const next = `${value.slice(0, start)}${before}${selected}${after}${value.slice(end)}`
    applyChange(next, { start: start + before.length, end: end + before.length })
  }

  const insertBlock = (prefix: string) => {
    const element = textareaRef.current
    const start = element?.selectionStart ?? value.length
    const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
    const next = `${value.slice(0, lineStart)}${prefix}${value.slice(lineStart)}`
    applyChange(next, { start: start + prefix.length, end: start + prefix.length })
  }

  const insertImage = async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files).filter((file) => file.type.startsWith('image/')) : []
    if (list.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const snippets: string[] = []
      for (const file of list) {
        const dataUrl = await compressImage(file)
        const alt = file.name.replace(/\.[a-z0-9]+$/i, '') || '图片'
        snippets.push(`![${alt}](${dataUrl})\n`)
      }
      const element = textareaRef.current
      const start = element?.selectionStart ?? value.length
      const insertion = `${snippets.join('')}`
      const next = `${value.slice(0, start)}${insertion}${value.slice(start)}`
      // 正文总量（含图片 base64）有上限，插入前先拦住，避免保存时才报错
      if (next.length > CONTENT_MAX_CHARS) {
        setError('这条待办的图片已经太多，请先删除部分图片再插入')
        return
      }
      applyChange(next, { start: start + insertion.length, end: start + insertion.length })
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '插入图片失败')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const runTool = (id: (typeof TOOLS)[number]['id']) => {
    switch (id) {
      case 'bold':
        wrapSelection('**')
        return
      case 'italic':
        wrapSelection('*')
        return
      case 'strike':
        wrapSelection('~~')
        return
      case 'heading':
        insertBlock('## ')
        return
      case 'list':
        insertBlock('- ')
        return
      case 'quote':
        insertBlock('> ')
        return
      case 'code':
        wrapSelection('`')
        return
      case 'link': {
        const element = textareaRef.current
        const selected = value.slice(element?.selectionStart ?? 0, element?.selectionEnd ?? 0)
        wrapSelection('[', `](https://)`)
        if (!selected) return
        return
      }
    }
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Escape' && onRequestCancel) {
      event.preventDefault()
      onRequestCancel()
      return
    }
    if (!(event.ctrlKey || event.metaKey)) return
    const key = event.key.toLowerCase()
    if (event.key === 'Enter' && onRequestSave) {
      event.preventDefault()
      onRequestSave()
    } else if (key === 's' && onRequestSave) {
      event.preventDefault()
      onRequestSave()
    } else if (key === 'b') {
      event.preventDefault()
      runTool('bold')
    } else if (key === 'i') {
      event.preventDefault()
      runTool('italic')
    } else if (key === 'k') {
      event.preventDefault()
      runTool('link')
    }
  }

  const preview = useMemo(() => value, [value])
  // 字数只算文字（图片按占位符计）：快接近上限时才提示，避免打扰
  const textLength = useMemo(() => contentTextLength(value), [value])
  const showCounter = textLength > CONTENT_TEXT_LIMIT * 0.8

  return (
    <div className={`rich-editor ${compact ? 'compact' : ''} ${disabled ? 'disabled' : ''}`}>
      <div className="rich-toolbar">
        <div className="rich-tools">
          {!compact &&
            TOOLS.map((tool) => {
              const Icon = tool.icon
              return (
                <button
                  key={tool.id}
                  type="button"
                  className="rich-tool"
                  title={tool.label}
                  disabled={disabled || busy}
                  onClick={() => runTool(tool.id)}
                  data-testid={`rich-tool-${tool.id}`}
                >
                  <Icon size={15} />
                </button>
              )
            })}
          {compact && <span className="rich-hint static">补充内容（支持 Markdown）</span>}
          <span className="rich-sep" />
          <button
            type="button"
            className="rich-tool"
            title="插入图片（也可直接粘贴或拖拽）"
            disabled={disabled || busy}
            onClick={() => fileRef.current?.click()}
            data-testid="rich-tool-image"
          >
            <ImageIcon size={15} />
          </button>
          {compact && onAttachFiles && (
            <button
              type="button"
              className="rich-tool"
              title="上传附件（≤10MB/个）"
              disabled={disabled || busy}
              onClick={() => attachRef.current?.click()}
              data-testid="rich-tool-attach"
            >
              <PaperclipIcon size={15} />
            </button>
          )}
          {showCounter && (
            <span
              className={`rich-counter ${textLength > CONTENT_TEXT_LIMIT ? 'over' : ''}`}
              title={`正文文字上限 ${CONTENT_TEXT_LIMIT} 字（插入的图片不计入）`}
              data-testid="rich-counter"
            >
              {textLength}/{CONTENT_TEXT_LIMIT}
            </span>
          )}
          {hasContent && !disabled && (
            <button
              type="button"
              className="rich-tool danger"
              title="清空详细内容"
              onClick={() => applyChange('', { start: 0, end: 0 })}
              data-testid="rich-tool-clear"
            >
              <TrashIcon size={15} />
            </button>
          )}
        </div>
        {compact ? null : (
          <div className="rich-modes">
            <button
              type="button"
              className={`rich-mode ${mode === 'edit' ? 'active' : ''}`}
              onClick={() => setMode('edit')}
              data-testid="rich-mode-edit"
            >
              编辑
            </button>
            <button
              type="button"
              className={`rich-mode ${mode === 'split' ? 'active' : ''}`}
              onClick={() => setMode('split')}
              data-testid="rich-mode-split"
            >
              分栏
            </button>
            <button
              type="button"
              className={`rich-mode ${mode === 'preview' ? 'active' : ''}`}
              onClick={() => setMode('preview')}
              data-testid="rich-mode-preview"
            >
              <EyeIcon size={13} />
              预览
            </button>
          </div>
        )}
      </div>

      <div className={`rich-body mode-${mode}`}>
        <textarea
          ref={textareaRef}
          className="detail-content-input rich-textarea"
          value={value}
          disabled={disabled}
          placeholder={placeholder ?? '支持 Markdown：**加粗**、- 列表、> 引用，可直接粘贴或拖入图片…'}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={onKeyDown}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((file) =>
              file.type.startsWith('image/')
            )
            if (files.length === 0) return
            event.preventDefault()
            void insertImage(files)
          }}
          onDrop={(event) => {
            const files = Array.from(event.dataTransfer?.files ?? []).filter((file) =>
              file.type.startsWith('image/')
            )
            if (files.length === 0) return
            event.preventDefault()
            void insertImage(files)
          }}
          data-testid={testId}
        />
        {(mode === 'split' || mode === 'preview') && (
          <div className="rich-preview" data-testid="rich-preview">
            {preview.trim() ? <Markdown content={preview} /> : <p className="rich-preview-empty">还没有内容</p>}
          </div>
        )}
      </div>

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => void insertImage(event.target.files)}
        data-testid="rich-image-input"
      />
      {compact && onAttachFiles && (
        <input
          ref={attachRef}
          type="file"
          multiple
          hidden
          onChange={(event) => {
            const files = event.target.files ? Array.from(event.target.files) : []
            if (files.length > 0) onAttachFiles(files)
            if (attachRef.current) attachRef.current.value = ''
          }}
          data-testid="rich-attach-input"
        />
      )}
      {busy && <span className="rich-hint">正在处理图片…</span>}
      {error && <span className="rich-hint error">{error}</span>}
    </div>
  )
}
