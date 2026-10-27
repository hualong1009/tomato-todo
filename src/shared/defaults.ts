import type { AppSettings, Group, Urgency } from './types'

export const DEFAULT_GROUP_ID = 'inbox'

export const GROUP_COLORS = [
  '#7aa2ff',
  '#ff7a90',
  '#ffb45c',
  '#59d9a5',
  '#b38cff',
  '#43c8e8',
  '#f06fd2',
  '#a7d85e'
]

export const URGENCY_META: Record<
  Urgency,
  { label: string; short: string; color: string; rank: number; description: string }
> = {
  urgent: {
    label: '紧急',
    short: '急',
    color: '#ff4d6d',
    rank: 4,
    description: '必须立即处理'
  },
  high: {
    label: '高',
    short: '高',
    color: '#ff9f43',
    rank: 3,
    description: '优先安排'
  },
  medium: {
    label: '中',
    short: '中',
    color: '#4ea8ff',
    rank: 2,
    description: '正常推进'
  },
  low: {
    label: '低',
    short: '低',
    color: '#62d6a3',
    rank: 1,
    description: '有空再做'
  }
}

export const STICKY_COLORS = [
  '#fff1a8',
  '#ffd0d8',
  '#cfe4ff',
  '#c9f5dc',
  '#e4d4ff',
  '#ffe0c2',
  '#f4f4f5',
  '#20242e'
]

export const DEFAULT_PROMPT_TEMPLATE = `你是一位洞察敏锐、说话直接的个人生产力教练。请基于下面的待办数据，生成一份「{{range}}」回顾总结。

## 数据概览
- 时间范围：{{rangeStart}} 至 {{rangeEnd}}
- 待办总数：{{total}}，已完成：{{completedCount}}，进行中：{{inProgressCount}}，未开始：{{notStartedCount}}，已逾期未完成：{{overdueCount}}
- 完成率：{{completionRate}}
- 累计专注：{{focusMinutes}} 分钟，共 {{focusSessions}} 次
- 紧急程度分布：{{urgencyStats}}
- 分组情况：{{groups}}

## 待办明细
{{todos}}

## 输出要求
1. 使用中文 Markdown，控制在 500 字以内；语气具体、克制，不要空泛鼓励。
2. 开头用一句话概括这段时间的执行状态。
3. 提炼 3-5 项关键进展，并指出被拖延、逾期或反复出现的阻塞点。
4. 结合紧急程度与期望完成时间，给出 3 条具体、可执行的下一步建议，必要时说明优先级调整。
5. 只依据给定数据，不要编造事实；数据不足时直接说明。`

export const DEFAULT_LOCAL_BACKUP = {
  password: '',
  lastBackupAt: null
}

export const DEFAULT_SETTINGS: AppSettings = {
  ai: {
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    model: 'gpt-4o-mini'
  },
  promptTemplate: DEFAULT_PROMPT_TEMPLATE,
  promptTemplates: [],
  activePromptTemplateId: 'default',
  pomodoro: {
    focusMinutes: 25,
    breakMinutes: 5
  },
  general: {
    hotkey: 'CommandOrControl+Shift+Space',
    theme: 'dark',
    closeToTray: true
  },
  webdav: {
    enabled: false,
    url: '',
    remotePath: 'tomato-todo/data.json',
    username: '',
    password: '',
    autoUpload: true,
    encryptionPassword: '',
    splitAssets: true,
    lastSyncAt: null,
    lastStatus: 'idle',
    lastError: null
  },
  security: {
    passwordHash: '',
    autoLockMinutes: 5
  },
  localBackup: DEFAULT_LOCAL_BACKUP
}

export const DEFAULT_GROUPS: Group[] = [
  {
    id: DEFAULT_GROUP_ID,
    name: '收件箱',
    color: '#7aa2ff',
    createdAt: new Date().toISOString()
  }
]

export const DEFAULT_STICKY_COLOR = '#fff1a8'
export const DEFAULT_STICKY_OPACITY = 0.94
