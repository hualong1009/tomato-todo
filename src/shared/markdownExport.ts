import { URGENCY_META } from './defaults'
import { getTodoStatus, STATUS_META } from './todoUtils'
import type { AppState, Group, Todo } from './types'

export interface ExportImage {
  /** 写入磁盘时使用的文件名，例如 image-1.png */
  name: string
  /** data:image/...;base64,... 原始内容 */
  dataUrl: string
}

export interface MarkdownExportResult {
  markdown: string
  images: ExportImage[]
  /** 附件（写入 attachments/ 目录并链接），保证导出包含完整文件 */
  files: ExportImage[]
}

/** 抽取正文内嵌图片的结果。 */
export interface ExtractedContent {
  markdown: string
  images: ExportImage[]
}

/** 把文件名转成适合写盘的名字：去掉路径分隔符与危险字符。 */
function safeFileName(name: string): string {
  return (
    name
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 80) || 'attachment'
  )
}

const DATA_URL_PATTERN = /!\[([^\]]*)\]\((data:image\/([a-z0-9.+-]+);base64,[A-Za-z0-9+/=\s]+)\)/gi

function imageExtension(mime: string): string {
  const normalised = mime.toLowerCase()
  if (normalised.includes('png')) return 'png'
  if (normalised.includes('jpeg') || normalised.includes('jpg')) return 'jpg'
  if (normalised.includes('webp')) return 'webp'
  if (normalised.includes('gif')) return 'gif'
  if (normalised.includes('svg')) return 'svg'
  return 'png'
}

/** 把正文里的内嵌 base64 图片抽出来，改写成相对路径，避免 Markdown 文件过大。 */
export function extractInlineImages(
  markdown: string,
  assetsDirName = 'attachments',
  namePrefix = ''
): ExtractedContent {
  const images: ExportImage[] = []
  const replaced = markdown.replace(DATA_URL_PATTERN, (_match, alt: string, dataUrl: string, mime: string) => {
    const image: ExportImage = {
      name: `${namePrefix}image-${images.length + 1}.${imageExtension(mime)}`,
      dataUrl
    }
    images.push(image)
    return `![${alt}](./${assetsDirName}/${image.name})`
  })
  return { markdown: replaced, images }
}

function formatDate(value: string | null): string {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  const pad = (input: number) => String(input).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** 单条待办的 Markdown 片段（含元信息表格与正文）。 */
export function buildTodoMarkdown(
  todo: Todo,
  group: Group | undefined,
  assetsDirName = 'attachments',
  namePrefix = ''
): { markdown: string; images: ExportImage[]; files: ExportImage[] } {
  const status = getTodoStatus(todo)
  const lines: string[] = []
  lines.push(`## ${todo.archivedAt ? '🗄️ ' : todo.completedAt ? '✅ ' : '📌 '}${todo.title}`)
  lines.push('')
  lines.push('| 项目 | 内容 |')
  lines.push('| --- | --- |')
  lines.push(`| 状态 | ${todo.archivedAt ? '已归档' : STATUS_META[status].label} |`)
  lines.push(`| 分组 | ${group ? group.name : '未分组'} |`)
  lines.push(`| 紧急程度 | ${URGENCY_META[todo.urgency].label} |`)
  lines.push(`| 创建时间 | ${formatDate(todo.createdAt)} |`)
  lines.push(`| 期望完成 | ${formatDate(todo.expectedAt)} |`)
  lines.push(`| 实际开始 | ${formatDate(todo.startedAt)} |`)
  lines.push(`| 实际完成 | ${formatDate(todo.completedAt)} |`)
  lines.push(`| 番茄次数 | ${todo.pomodoroCount} 次（${todo.focusMinutes} 分钟） |`)
  if (todo.archivedAt) lines.push(`| 归档时间 | ${formatDate(todo.archivedAt)} |`)
  lines.push('')
  const content = todo.content.trim()
  let images: ExportImage[] = []
  if (content) {
    const extracted = extractInlineImages(content, assetsDirName, namePrefix)
    images = extracted.images
    lines.push('### 详细内容')
    lines.push('')
    lines.push(extracted.markdown)
    lines.push('')
  }
  const files: ExportImage[] = []
  if (todo.attachments.length > 0) {
    lines.push('### 附件')
    lines.push('')
    todo.attachments.forEach((attachment, index) => {
      const fileName = `${namePrefix}${index + 1}-${safeFileName(attachment.name)}`
      files.push({ name: fileName, dataUrl: attachment.data })
      lines.push(`- [${attachment.name}](./${assetsDirName}/${fileName}) · ${attachment.size} B`)
    })
    lines.push('')
  }
  if (todo.focusLog.length > 0) {
    const recent = todo.focusLog.slice(-10)
    lines.push('<details><summary>专注记录（最近 10 次）</summary>')
    lines.push('')
    for (const entry of recent) lines.push(`- ${formatDate(entry.at)} · ${entry.minutes} 分钟`)
    lines.push('')
    lines.push('</details>')
    lines.push('')
  }
  return { markdown: lines.join('\n'), images, files }
}

export interface BuildExportOptions {
  includeArchived?: boolean
  /** 导出时的标题，默认「番茄待办导出」 */
  title?: string
  now?: Date
}

/** 生成完整导出的 Markdown 文档，按分组归类。 */
export function buildExportMarkdown(
  state: Pick<AppState, 'todos' | 'groups'>,
  todoIds: string[] | null,
  options: BuildExportOptions = {}
): MarkdownExportResult {
  const includeArchived = options.includeArchived !== false
  const selected = todoIds ? new Set(todoIds) : null
  const now = options.now ?? new Date()
  const todos = state.todos.filter((todo) => {
    if (selected && !selected.has(todo.id)) return false
    if (!includeArchived && todo.archivedAt) return false
    return true
  })
  const groupMap = new Map(state.groups.map((group) => [group.id, group]))
  const images: ExportImage[] = []
  const files: ExportImage[] = []

  const lines: string[] = []
  lines.push(`# ${options.title ?? '番茄待办导出'}`)
  lines.push('')
  lines.push(`> 导出时间：${formatDate(now.toISOString())} · 共 ${todos.length} 条待办`)
  lines.push('')

  const ordered = [...state.groups].sort((a, b) => {
    const left = a.id === 'inbox' ? -1 : 0
    const right = b.id === 'inbox' ? -1 : 0
    return left - right
  })
  const knownGroups = new Set(ordered.map((group) => group.id))
  const buckets: { group: Group | undefined; todos: Todo[] }[] = []
  for (const group of ordered) {
    const items = todos
      .filter((todo) => todo.groupId === group.id)
      .sort((a, b) => Number(Boolean(a.completedAt)) - Number(Boolean(b.completedAt)))
    if (items.length > 0) buckets.push({ group, todos: items })
  }
  const orphan = todos.filter((todo) => !knownGroups.has(todo.groupId))
  if (orphan.length > 0) buckets.push({ group: undefined, todos: orphan })

  for (const bucket of buckets) {
    lines.push(`## 📁 ${bucket.group ? bucket.group.name : '未分组'}`)
    lines.push('')
    for (const todo of bucket.todos) {
      const built = buildTodoMarkdown(todo, groupMap.get(todo.groupId), 'attachments', `g${images.length + 1}-`)
      lines.push(built.markdown)
      lines.push('---')
      lines.push('')
      images.push(...built.images)
      files.push(...built.files)
    }
  }

  if (todos.length === 0) {
    lines.push('_没有可导出的待办。_')
    lines.push('')
  }

  return { markdown: lines.join('\n'), images, files }
}
