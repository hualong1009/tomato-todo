import { useEffect, useState } from 'react'
import { DEFAULT_PROMPT_TEMPLATE } from '@shared/defaults'
import type { AppSettings, McpInfo, PromptTemplate, WebDAVSettings } from '@shared/types'
import {
  acceleratorFromEvent,
  cleanError,
  prettifyHotkey
} from '../utils/format'
import { SYNC_INTERVAL_OPTIONS } from '@shared/webdavSync'
import { isMobile } from '../platform'
import { ConfirmDialog } from './Dialogs'
import { Dropdown } from './Dropdown'
import { Modal } from './Modal'
import {
  AlertIcon,
  CheckIcon,
  CloudCheckIcon,
  CloudIcon,
  CloudOffIcon,
  CopyIcon,
  DownloadIcon,
  ExternalIcon,
  FileTextIcon,
  UploadIcon,
  EyeIcon,
  EyeOffIcon,
  LockIcon,
  PencilIcon,
  SettingsIcon,
  SparklesIcon,
  TimerIcon,
  TomatoIcon,
  TrashIcon
} from './Icons'

type Tab = 'ai' | 'prompt' | 'pomodoro' | 'general' | 'webdav' | 'localbackup' | 'security' | 'mcp' | 'about'

interface SettingsModalProps {
  open: boolean
  settings: AppSettings
  onClose: () => void
  onSave: (settings: AppSettings) => Promise<{ ok: boolean; warning?: string }>
  onToast: (message: string, tone?: 'info' | 'success' | 'error') => void
  onCheckUpdates: () => Promise<void>
}

const TABS: { key: Tab; label: string; icon: React.ReactNode }[] = [
  { key: 'general', label: '通用 / 快捷键', icon: <SettingsIcon size={16} /> },
  { key: 'pomodoro', label: '番茄钟', icon: <TimerIcon size={16} /> },
  { key: 'ai', label: 'AI 接口', icon: <SparklesIcon size={16} /> },
  { key: 'prompt', label: '提示词模板', icon: <FileTextIcon size={16} /> },
  { key: 'webdav', label: 'WebDAV 备份', icon: <CloudIcon size={16} /> },
  { key: 'localbackup', label: '本地备份 / 导出', icon: <CloudCheckIcon size={16} /> },
  { key: 'security', label: '安全 / 重置', icon: <LockIcon size={16} /> },
  { key: 'mcp', label: 'MCP 接入', icon: <ExternalIcon size={16} /> },
  { key: 'about', label: '关于', icon: <TomatoIcon size={16} /> }
]

const SYNC_INTERVAL_DROPDOWN = SYNC_INTERVAL_OPTIONS.map((minutes) => ({
  value: String(minutes),
  label: minutes === 0 ? '关闭定时同步' : `每 ${minutes} 分钟`,
  color: minutes === 0 ? '#8b96b1' : '#4ea8ff'
}))

const AUTO_LOCK_OPTIONS = [
  { value: '0', label: '不自动锁定', color: '#8b96b1' },
  { value: '1', label: '1 分钟', color: '#ff4d6d' },
  { value: '5', label: '5 分钟', color: '#ff9f43' },
  { value: '10', label: '10 分钟', color: '#4ea8ff' },
  { value: '30', label: '30 分钟', color: '#62d6a3' },
  { value: '60', label: '1 小时', color: '#b38cff' }
]

import {
  DEFAULT_TEMPLATE_ID,
  duplicatePromptTemplate,
  listPromptTemplates
} from '@shared/promptTemplates'
const PLACEHOLDERS = [
  '{{range}}',
  '{{rangeStart}}',
  '{{rangeEnd}}',
  '{{total}}',
  '{{completedCount}}',
  '{{pendingCount}}',
  '{{inProgressCount}}',
  '{{notStartedCount}}',
  '{{overdueCount}}',
  '{{completionRate}}',
  '{{focusMinutes}}',
  '{{focusSessions}}',
  '{{urgencyStats}}',
  '{{groups}}',
  '{{todos}}'
]

export function SettingsModal({ open, settings, onClose, onSave, onToast, onCheckUpdates }: SettingsModalProps) {
  const [tab, setTab] = useState<Tab>('general')
  const [draft, setDraft] = useState<AppSettings>(settings)
  const [saveBusy, setSaveBusy] = useState(false)
  const [aiTesting, setAiTesting] = useState(false)
  const [aiTest, setAiTest] = useState<{ ok: boolean; message: string } | null>(null)
  const [aiModels, setAiModels] = useState<string[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [recording, setRecording] = useState(false)
  const [webdavBusy, setWebdavBusy] = useState<'test' | 'sync' | 'upload' | 'restore' | null>(null)
  const [webdavResult, setWebdavResult] = useState<{ ok: boolean; message: string } | null>(null)
  const [confirmRestore, setConfirmRestore] = useState(false)
  const [mcpInfo, setMcpInfo] = useState<McpInfo | null>(null)
  const [fileBusy, setFileBusy] = useState<'export-md' | 'export-backup' | 'import' | null>(null)
  const [passwordDraft, setPasswordDraft] = useState({ current: '', next: '', confirm: '' })
  const [passwordBusy, setPasswordBusy] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const [editingTemplateId, setEditingTemplateId] = useState<string>(DEFAULT_TEMPLATE_ID)
  const [confirmDeleteTemplateId, setConfirmDeleteTemplateId] = useState<string | null>(null)
  const [resetPassword, setResetPassword] = useState('')
  const [resetBusy, setResetBusy] = useState(false)
  const [updateBusy, setUpdateBusy] = useState(false)
  const hasPassword = settings.security.passwordHash !== ''

  useEffect(() => {
    if (open) {
      setDraft(structuredClone(settings))
      setEditingTemplateId(settings.activePromptTemplateId || DEFAULT_TEMPLATE_ID)
      setConfirmDeleteTemplateId(null)
      setAiTest(null)
      setAiModels([])
      setWebdavResult(null)
      setRecording(false)
      setPasswordDraft({ current: '', next: '', confirm: '' })
      setConfirmReset(false)
      setResetPassword('')
    }
  }, [open, settings])

  useEffect(() => {
    if (open && tab === 'mcp' && !mcpInfo) {
      void window.api.getMcpInfo().then(setMcpInfo)
    }
  }, [open, tab, mcpInfo])

  useEffect(() => {
    if (!recording) return
    const handle = (event: KeyboardEvent) => {
      event.preventDefault()
      event.stopPropagation()
      if (event.key === 'Escape') {
        setRecording(false)
        return
      }
      const accelerator = acceleratorFromEvent(event)
      if (accelerator) {
        setDraft((previous) => ({
          ...previous,
          general: { ...previous.general, hotkey: accelerator }
        }))
        setRecording(false)
      }
    }
    window.addEventListener('keydown', handle, true)
    return () => window.removeEventListener('keydown', handle, true)
  }, [recording])

  const updateAI = (patch: Partial<AppSettings['ai']>) => {
    setDraft((previous) => ({ ...previous, ai: { ...previous.ai, ...patch } }))
    setAiTest(null)
  }
  const updateWebdav = (patch: Partial<WebDAVSettings>) => {
    setDraft((previous) => ({ ...previous, webdav: { ...previous.webdav, ...patch } }))
    setWebdavResult(null)
  }

  const runMarkdownExport = async (includeArchived: boolean, key: 'export-md') => {
    setFileBusy(key)
    try {
      const result = await window.api.exportMarkdown({ scope: 'all', includeArchived })
      onToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setFileBusy(null)
    }
  }

  const runExportBackup = async () => {
    setFileBusy('export-backup')
    try {
      // 先把草稿里的密码保存下来，主进程导出时读的是已保存设置
      if (!(await save())) return
      const result = await window.api.exportLocalBackup()
      onToast(result.message, result.ok ? 'success' : 'error')
      if (result.ok) {
        const state = await window.api.getState()
        setDraft(state.settings)
      }
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setFileBusy(null)
    }
  }

  const runImportBackup = async () => {
    setFileBusy('import')
    try {
      if (!(await save())) return
      const result = await window.api.importLocalBackup()
      onToast(result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setFileBusy(null)
    }
  }

  const templates = listPromptTemplates(draft)
  const editingTemplate =
    templates.find((template) => template.id === editingTemplateId) ?? templates[0]

  const patchTemplateDraft = (patch: {
    promptTemplates?: PromptTemplate[]
    activePromptTemplateId?: string
    promptTemplate?: string
  }) => {
    setDraft((previous) => ({ ...previous, ...patch }))
  }

  const addTemplateFrom = (base: PromptTemplate) => {
    const template = duplicatePromptTemplate(base)
    patchTemplateDraft({
      promptTemplates: [...draft.promptTemplates, template],
      activePromptTemplateId: template.id,
      promptTemplate: template.content
    })
    setEditingTemplateId(template.id)
    onToast(`已从「${base.name}」复制出新模板`, 'success')
  }

  const editTemplateField = (changes: { name?: string; content?: string }) => {
    if (editingTemplate.builtin) return
    patchTemplateDraft({
      promptTemplates: draft.promptTemplates.map((template) =>
        template.id === editingTemplate.id
          ? { ...template, ...changes, updatedAt: new Date().toISOString() }
          : template
      ),
      promptTemplate:
        editingTemplate.id === draft.activePromptTemplateId
          ? changes.content ?? editingTemplate.content
          : draft.promptTemplate
    })
  }

  const removeTemplate = (id: string) => {
    const remaining = draft.promptTemplates.filter((template) => template.id !== id)
    const activeFallsBack = draft.activePromptTemplateId === id
    patchTemplateDraft({
      promptTemplates: remaining,
      activePromptTemplateId: activeFallsBack ? DEFAULT_TEMPLATE_ID : draft.activePromptTemplateId,
      promptTemplate: activeFallsBack ? DEFAULT_PROMPT_TEMPLATE : draft.promptTemplate
    })
    if (editingTemplateId === id) setEditingTemplateId(DEFAULT_TEMPLATE_ID)
    setConfirmDeleteTemplateId(null)
    onToast('模板已删除', 'success')
  }

  const save = async (): Promise<boolean> => {
    setSaveBusy(true)
    try {
      const result = await onSave(draft)
      if (result.ok) {
        onToast('设置已保存', 'success')
        if (result.warning) onToast(result.warning, 'error')
        return true
      }
      return false
    } catch (error) {
      onToast(cleanError(error), 'error')
      return false
    } finally {
      setSaveBusy(false)
    }
  }

  const fetchModels = async () => {
    if (modelsBusy) return
    setModelsBusy(true)
    setAiTest(null)
    try {
      const result = await window.api.listAIModels(draft.ai)
      if (!result.ok) {
        setAiTest({ ok: false, message: result.error ?? '获取模型列表失败' })
        return
      }
      setAiModels(result.models)
      const current = draft.ai.model.trim()
      if (!result.models.includes(current)) {
        updateAI({ model: result.models[0] })
      }
      onToast(`已获取 ${result.models.length} 个可用模型`, 'success')
    } catch (error) {
      setAiTest({ ok: false, message: cleanError(error) })
    } finally {
      setModelsBusy(false)
    }
  }

  const testAI = async () => {
    if (aiTesting) return
    setAiTesting(true)
    setAiTest(null)
    try {
      const result = await window.api.testAI(draft.ai)
      setAiTest({ ok: result.ok, message: result.ok ? result.content ?? '连接成功' : result.error ?? '连接失败' })
    } catch (error) {
      setAiTest({ ok: false, message: cleanError(error) })
    } finally {
      setAiTesting(false)
    }
  }

  const testWebdav = async () => {
    setWebdavBusy('test')
    setWebdavResult(null)
    try {
      const result = await window.api.testWebDAV(draft.webdav)
      setWebdavResult({ ok: result.ok, message: result.message })
    } catch (error) {
      setWebdavResult({ ok: false, message: cleanError(error) })
    } finally {
      setWebdavBusy(null)
    }
  }

  const syncNow = async () => {
    setWebdavBusy('sync')
    try {
      const saved = await onSave(draft)
      if (!saved.ok) return
      const result = await window.api.syncWebDAV()
      setWebdavResult({ ok: result.ok, message: result.message })
      if (result.ok) onToast(result.message, 'success')
      else onToast(result.message, 'error')
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setWebdavBusy(null)
    }
  }

  const uploadNow = async () => {
    setWebdavBusy('upload')
    try {
      const saved = await onSave(draft)
      if (!saved.ok) return
      const result = await window.api.uploadWebDAV()
      setWebdavResult({ ok: result.ok, message: result.message })
      onToast(result.ok ? 'WebDAV 备份成功' : result.message, result.ok ? 'success' : 'error')
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setWebdavBusy(null)
    }
  }

  const restoreNow = async () => {
    setWebdavBusy('restore')
    try {
      const saved = await onSave(draft)
      if (!saved.ok) return
      const result = await window.api.restoreWebDAV()
      setWebdavResult({ ok: result.ok, message: result.message })
      onToast(result.message, result.ok ? 'success' : 'error')
      if (result.ok) onClose()
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setWebdavBusy(null)
    }
  }

  const submitPassword = async (mode: 'set' | 'clear') => {
    if (passwordBusy) return
    if (mode === 'set') {
      if (passwordDraft.next.length < 4) {
        onToast('密码至少需要 4 位', 'error')
        return
      }
      if (passwordDraft.next !== passwordDraft.confirm) {
        onToast('两次输入的新密码不一致', 'error')
        return
      }
    }
    setPasswordBusy(true)
    try {
      const result = await window.api.setSecurityPassword({
        currentPassword: hasPassword ? passwordDraft.current : undefined,
        newPassword: mode === 'clear' ? '' : passwordDraft.next
      })
      onToast(result.message ?? (result.ok ? '已更新' : '操作失败'), result.ok ? 'success' : 'error')
      if (result.ok) setPasswordDraft({ current: '', next: '', confirm: '' })
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setPasswordBusy(false)
    }
  }

  const lockNow = async () => {
    try {
      const result = await window.api.lockNow()
      if (!result.ok) onToast(result.message ?? '请先设置管理员密码', 'error')
    } catch (error) {
      onToast(cleanError(error), 'error')
    }
  }

  const performReset = async () => {
    if (resetBusy) return
    if (hasPassword && !resetPassword) return
    setResetBusy(true)
    try {
      const result = await window.api.resetApp(hasPassword ? resetPassword : undefined)
      if (result.ok) {
        onToast('应用已重置，所有数据已清空', 'success')
        setConfirmReset(false)
        setResetPassword('')
        onClose()
      } else {
        onToast(result.message ?? '重置失败', 'error')
      }
    } catch (error) {
      onToast(cleanError(error), 'error')
    } finally {
      setResetBusy(false)
    }
  }

  const changeProvider = (provider: AppSettings['ai']['provider']) => {
    const base = draft.ai.baseUrl
    const update: Partial<AppSettings['ai']> = { provider }
    if (!base || base === 'https://api.openai.com/v1' || base === 'https://api.anthropic.com/v1') {
      update.baseUrl = provider === 'openai' ? 'https://api.openai.com/v1' : 'https://api.anthropic.com/v1'
    }
    if (!draft.ai.model || draft.ai.model === 'gpt-4o-mini' || draft.ai.model === 'claude-3-5-sonnet-latest') {
      update.model = provider === 'openai' ? 'gpt-4o-mini' : 'claude-3-5-sonnet-latest'
    }
    updateAI(update)
  }

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title={
          <div className="settings-title">
            <span className="settings-mark">
              <SettingsIcon size={18} />
            </span>
            <div>
              <strong>设置</strong>
              <small>配置 AI、番茄钟、快捷键、WebDAV 与 MCP</small>
            </div>
          </div>
        }
        className="settings-modal"
        testId="settings-modal"
      >
        <div className="settings-layout">
          <nav className="settings-nav">
            {(isMobile ? TABS.filter((item) => item.key !== 'mcp' && item.key !== 'security') : TABS).map((item) => (
              <button
                key={item.key}
                className={tab === item.key ? 'active' : ''}
                onClick={() => setTab(item.key)}
                data-testid={`settings-tab-${item.key}`}
              >
                {item.icon}
                {item.label}
              </button>
            ))}
          </nav>

          <div className="settings-content">
            {tab === 'ai' && (
              <section className="settings-section">
                <h3>AI 接口</h3>
                <p className="settings-desc">支持 OpenAI 兼容与 Anthropic 兼容端点。密钥只保存在本地数据文件中。</p>
                <div className="provider-cards">
                  <button
                    className={`provider-card ${draft.ai.provider === 'openai' ? 'active' : ''}`}
                    onClick={() => changeProvider('openai')}
                    data-testid="setting-provider-openai"
                  >
                    <strong>OpenAI 兼容</strong>
                    <span>POST /chat/completions</span>
                  </button>
                  <button
                    className={`provider-card ${draft.ai.provider === 'anthropic' ? 'active' : ''}`}
                    onClick={() => changeProvider('anthropic')}
                    data-testid="setting-provider-anthropic"
                  >
                    <strong>Anthropic 兼容</strong>
                    <span>POST /messages</span>
                  </button>
                </div>
                <label className="field">
                  <span>Base URL</span>
                  <input
                    value={draft.ai.baseUrl}
                    onChange={(event) => updateAI({ baseUrl: event.target.value })}
                    placeholder="https://api.openai.com/v1"
                    data-testid="setting-ai-base"
                  />
                  <small>可填写到 /v1，也可直接填写完整的 /chat/completions 或 /messages 地址。</small>
                </label>
                <label className="field">
                  <span>API Key</span>
                  <div className="input-with-action">
                    <input
                      type={showKey ? 'text' : 'password'}
                      value={draft.ai.apiKey}
                      onChange={(event) => updateAI({ apiKey: event.target.value })}
                      placeholder="sk-..."
                      data-testid="setting-ai-key"
                    />
                    <button className="input-action" onClick={() => setShowKey((value) => !value)} title="显示/隐藏">
                      {showKey ? <EyeOffIcon size={16} /> : <EyeIcon size={16} />}
                    </button>
                  </div>
                </label>
                <label className="field">
                  <span>模型</span>
                  <div className="model-row">
                    <input
                      list="ai-model-options"
                      value={draft.ai.model}
                      onChange={(event) => updateAI({ model: event.target.value })}
                      placeholder="gpt-4o-mini"
                      data-testid="setting-ai-model"
                    />
                    <datalist id="ai-model-options">
                      {aiModels.map((model) => (
                        <option key={model} value={model} />
                      ))}
                    </datalist>
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => void fetchModels()}
                      disabled={modelsBusy || !draft.ai.apiKey.trim()}
                      data-testid="setting-ai-models"
                    >
                      {modelsBusy ? <span className="spinner" /> : <SparklesIcon size={13} />}
                      {modelsBusy ? '读取中' : '获取模型'}
                    </button>
                  </div>
                  <small>
                    {aiModels.length > 0
                      ? `接口返回 ${aiModels.length} 个模型，可在输入框中直接选择。`
                      : '先填写 Base URL 和 API Key，再点击「获取模型」查看可用模型。'}
                  </small>
                </label>
                <div className="settings-inline">
                  <button
                    className="btn ghost"
                    onClick={() => void testAI()}
                    disabled={aiTesting || !draft.ai.apiKey}
                    data-testid="setting-ai-test"
                  >
                    {aiTesting ? <span className="spinner" /> : <SparklesIcon size={15} />}
                    {aiTesting ? '测试中…' : '测试连接'}
                  </button>
                  {aiTest && (
                    <span className={`inline-status ${aiTest.ok ? 'ok' : 'bad'}`}>
                      {aiTest.ok ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
                      {aiTest.message}
                    </span>
                  )}
                </div>
              </section>
            )}

            {tab === 'prompt' && (
              <section className="settings-section">
                <h3>提示词模板</h3>
                <p className="settings-desc">
                  AI 回顾会把占位符替换成实时数据。默认模板不可修改，可复制出新的模板自由编辑；删除前会二次确认。
                </p>

                <div className="template-list" data-testid="template-list">
                  {templates.map((template) => (
                    <div
                      key={template.id}
                      className={`template-row ${
                        template.id === editingTemplateId ? 'active' : ''
                      } ${template.id === draft.activePromptTemplateId ? 'current' : ''}`}
                      onClick={() => setEditingTemplateId(template.id)}
                      data-testid={`template-row-${template.id}`}
                    >
                      <div className="template-row-main">
                        <strong>{template.name}</strong>
                        {template.builtin ? (
                          <span className="template-badge">内置 · 不可修改</span>
                        ) : (
                          <span className="muted">{template.content.length} 字符</span>
                        )}
                        {template.id === draft.activePromptTemplateId && !template.builtin && (
                          <span className="template-badge used">上次使用</span>
                        )}
                      </div>
                      <div className="template-row-actions">
                        <button
                          className="tiny-btn"
                          title="复制为新模板"
                          onClick={(event) => {
                            event.stopPropagation()
                            addTemplateFrom(template)
                          }}
                          data-testid={`template-copy-${template.id}`}
                        >
                          <CopyIcon size={15} />
                        </button>
                        {!template.builtin && (
                          <>
                            <button
                              className="tiny-btn"
                              title="编辑"
                              onClick={(event) => {
                                event.stopPropagation()
                                setEditingTemplateId(template.id)
                              }}
                            >
                              <PencilIcon size={15} />
                            </button>
                            {confirmDeleteTemplateId === template.id ? (
                              <ConfirmDialog
                                open
                                title="删除模板"
                                message={`确定删除「${template.name}」？保存设置后生效。`}
                                confirmLabel="删除"
                                danger
                                onClose={() => setConfirmDeleteTemplateId(null)}
                                onConfirm={() => removeTemplate(template.id)}
                              />
                            ) : null}
                            <button
                              className="tiny-btn"
                              title="删除"
                              onClick={(event) => {
                                event.stopPropagation()
                                setConfirmDeleteTemplateId(template.id)
                              }}
                              data-testid={`template-delete-${template.id}`}
                            >
                              <TrashIcon size={15} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  className="btn ghost small"
                  onClick={() => addTemplateFrom(templates[0])}
                  data-testid="template-add"
                >
                  <CopyIcon size={14} />
                  从默认模板新建
                </button>

                {confirmDeleteTemplateId ? null : (
                  <div className="template-editor">
                    <div className="settings-inline space-between">
                      <label className="field template-name">
                        <span>模板名称</span>
                        <input
                          value={editingTemplate.builtin ? editingTemplate.name : editingTemplate.name}
                          onChange={(event) => editTemplateField({ name: event.target.value })}
                          disabled={editingTemplate.builtin}
                          data-testid="template-name-input"
                        />
                      </label>
                      {editingTemplate.builtin ? (
                        <span className="muted">默认模板不可修改，请先复制出新模板</span>
                      ) : (
                        <span className="muted">{editingTemplate.content.length} 字符</span>
                      )}
                    </div>
                    <div className="placeholder-list">
                      {PLACEHOLDERS.map((placeholder) => (
                        <code key={placeholder}>{placeholder}</code>
                      ))}
                    </div>
                    <textarea
                      className="prompt-editor"
                      value={editingTemplate.content}
                      onChange={(event) => editTemplateField({ content: event.target.value })}
                      disabled={editingTemplate.builtin}
                      rows={16}
                      data-testid="setting-prompt-template"
                    />
                  </div>
                )}
              </section>
            )}

            {tab === 'pomodoro' && (
              <section className="settings-section">
                <h3>番茄钟</h3>
                <p className="settings-desc">开始专注时，待办会自动标记为进行中；完成一个专注阶段会记录实际专注时间。</p>
                <div className="two-fields">
                  <label className="field">
                    <span>专注时长（分钟）</span>
                    <input
                      type="number"
                      min={1}
                      max={180}
                      value={draft.pomodoro.focusMinutes}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          pomodoro: { ...previous.pomodoro, focusMinutes: Number(event.target.value) || 25 }
                        }))
                      }
                      data-testid="setting-pomodoro-focus"
                    />
                  </label>
                  <label className="field">
                    <span>休息时长（分钟）</span>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      value={draft.pomodoro.breakMinutes}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          pomodoro: { ...previous.pomodoro, breakMinutes: Number(event.target.value) || 5 }
                        }))
                      }
                      data-testid="setting-pomodoro-break"
                    />
                  </label>
                </div>
                <div className="timer-preview">
                  <TomatoIcon size={26} />
                  <div>
                    <strong>{draft.pomodoro.focusMinutes}:00 专注</strong>
                    <span>然后 {draft.pomodoro.breakMinutes}:00 休息</span>
                  </div>
                </div>
              </section>
            )}

            {tab === 'general' && (
              <section className="settings-section">
                <h3>通用与快捷键</h3>
                <p className="settings-desc">全局快捷键可在应用隐藏或失焦时唤起窗口；再次按下可隐藏。</p>
                <div className="field">
                  <span>界面主题</span>
                  <div className="theme-cards">
                    <button
                      className={`theme-card ${draft.general.theme === 'dark' ? 'active' : ''}`}
                      onClick={() =>
                        setDraft((previous) => ({ ...previous, general: { ...previous.general, theme: 'dark' } }))
                      }
                      data-testid="setting-theme-dark"
                    >
                      <span className="theme-swatch dark" />
                      <strong>星河暗色</strong>
                    </button>
                    <button
                      className={`theme-card ${draft.general.theme === 'light' ? 'active' : ''}`}
                      onClick={() =>
                        setDraft((previous) => ({ ...previous, general: { ...previous.general, theme: 'light' } }))
                      }
                      data-testid="setting-theme-light"
                    >
                      <span className="theme-swatch light" />
                      <strong>晨光浅色</strong>
                    </button>
                    <button
                      className={`theme-card ${draft.general.theme === 'system' ? 'active' : ''}`}
                      onClick={() =>
                        setDraft((previous) => ({ ...previous, general: { ...previous.general, theme: 'system' } }))
                      }
                      data-testid="setting-theme-system"
                    >
                      <span className="theme-swatch system" />
                      <strong>跟随系统</strong>
                    </button>
                  </div>
                </div>
                {!isMobile && (
                  <label className="toggle-row">
                    <input
                      type="checkbox"
                      checked={draft.general.closeToTray}
                      onChange={(event) =>
                        setDraft((previous) => ({
                          ...previous,
                          general: { ...previous.general, closeToTray: event.target.checked }
                        }))
                      }
                      data-testid="setting-close-to-tray"
                    />
                    <span className="toggle-ui" />
                    <span>
                      <strong>关闭按钮最小化到托盘</strong>
                      <small>关闭时隐藏到系统托盘，用快捷键或托盘图标重新打开</small>
                    </span>
                  </label>
                )}
                {!isMobile && (
                <label className="field">
                  <span>全局唤起快捷键</span>
                  <div className="hotkey-row">
                    <div className={`hotkey-display ${recording ? 'recording' : ''}`}>
                      {recording ? '请按下组合键…' : prettifyHotkey(draft.general.hotkey)}
                    </div>
                    <button
                      className="btn ghost"
                      onClick={() => setRecording((value) => !value)}
                      data-testid="setting-hotkey-record"
                    >
                      {recording ? '取消录制' : '重新录制'}
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() =>
                        setDraft((previous) => ({
                          ...previous,
                          general: { ...previous.general, hotkey: 'CommandOrControl+Shift+Space' }
                        }))
                      }
                    >
                      恢复默认
                    </button>
                  </div>
                  <small>至少包含一个修饰键（Ctrl / Alt / Shift / Win）。</small>
                </label>
                )}
              </section>
            )}

            {tab === 'webdav' && (
              <section className="settings-section">
                <h3>WebDAV 备份</h3>
                <p className="settings-desc">
                  支持双向同步：本机一有改动就自动同步，其他设备改过则定时拉取，桌面端标题栏与手机端顶部栏都会显示同步状态和最后同步时间。远端备份不包含 AI 密钥与 WebDAV 密码。
                </p>
                <label className="toggle-row">
                  <input
                    type="checkbox"
                    checked={draft.webdav.enabled}
                    onChange={(event) => updateWebdav({ enabled: event.target.checked })}
                    data-testid="setting-webdav-enabled"
                  />
                  <span className="toggle-ui" />
                  <span>
                    <strong>启用 WebDAV 备份</strong>
                    <small>关闭后不会自动上传，但仍可手动备份</small>
                  </span>
                </label>
                <label className="field">
                  <span>服务器地址</span>
                  <input
                    value={draft.webdav.url}
                    onChange={(event) => updateWebdav({ url: event.target.value })}
                    placeholder="https://dav.example.com/remote.php/dav/files/me/"
                    data-testid="setting-webdav-url"
                  />
                </label>
                <label className="field">
                  <span>远端文件路径（相对服务器地址）</span>
                  <input
                    value={draft.webdav.remotePath}
                    onChange={(event) => updateWebdav({ remotePath: event.target.value })}
                    placeholder="tomato-todo/data.json"
                    data-testid="setting-webdav-path"
                  />
                </label>
                <div className="two-fields">
                  <label className="field">
                    <span>用户名</span>
                    <input
                      value={draft.webdav.username}
                      onChange={(event) => updateWebdav({ username: event.target.value })}
                      data-testid="setting-webdav-username"
                    />
                  </label>
                  <label className="field">
                    <span>密码 / 应用密码</span>
                    <input
                      type="password"
                      value={draft.webdav.password}
                      onChange={(event) => updateWebdav({ password: event.target.value })}
                      data-testid="setting-webdav-password"
                    />
                  </label>
                </div>
                <label className="field">
                  <span>备份加密密码（可选）</span>
                  <div className="input-with-action">
                    <input
                      type="password"
                      value={draft.webdav.encryptionPassword}
                      onChange={(event) => updateWebdav({ encryptionPassword: event.target.value })}
                      placeholder="留空则不加密"
                      data-testid="setting-webdav-encryption"
                    />
                    <button
                      className="input-action"
                      onClick={() => updateWebdav({ encryptionPassword: '' })}
                      title="清除加密密码"
                      tabIndex={-1}
                    >
                      <CloudOffIcon size={16} />
                    </button>
                  </div>
                  <small>
                    非空时上传前用 gzip + AES-256-GCM 加密备份、从远端恢复时自动解密；加密密码只保存在本机，不会上传。
                  </small>
                </label>
                <label className="toggle-row compact">
                    <input
                      type="checkbox"
                      checked={draft.webdav.splitAssets !== false}
                      onChange={(event) => updateWebdav({ splitAssets: event.target.checked })}
                      data-testid="setting-webdav-split-assets"
                    />
                    <span className="toggle-ui" />
                    <span>
                      <strong>图片与附件拆分上传</strong>
                      <small>正文图片、附件单独存到 blobs/，主备份文件保持几百 KB，且同一文件只传一次</small>
                    </span>
                  </label>
                <label className="toggle-row compact">
                  <input
                    type="checkbox"
                    checked={draft.webdav.autoUpload}
                    onChange={(event) => updateWebdav({ autoUpload: event.target.checked })}
                    data-testid="setting-webdav-auto"
                  />
                  <span className="toggle-ui" />
                  <span>
                    <strong>变动后自动同步</strong>
                    <small>保存详情、勾选完成、改分组等改动后约 1.6 秒自动同步（先上传本机改动）；关闭后改动会在下次定时同步时一起上传</small>
                  </span>
                </label>
                <label className="field">
                  <span>定时双向同步</span>
                  <Dropdown
                    value={String(draft.webdav.syncIntervalMinutes)}
                    options={SYNC_INTERVAL_DROPDOWN}
                    onChange={(next) => updateWebdav({ syncIntervalMinutes: Number(next) })}
                    testId="setting-webdav-sync-interval"
                  />
                  <small>
                    每隔一段时间先看远端有没有新备份：本机没改就自动拉取，本机改过就上传；两端都改过时保留本机数据并覆盖远端。
                  </small>
                </label>
                <div className="webdav-actions">
                  <button
                    className="btn ghost"
                    onClick={() => void testWebdav()}
                    disabled={Boolean(webdavBusy) || !draft.webdav.url}
                    data-testid="setting-webdav-test"
                  >
                    {webdavBusy === 'test' ? <span className="spinner" /> : <CloudIcon size={15} />}
                    测试 WebDAV
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => void syncNow()}
                    disabled={Boolean(webdavBusy) || !draft.webdav.url}
                    data-testid="setting-webdav-sync"
                  >
                    {webdavBusy === 'sync' ? <span className="spinner" /> : <CloudCheckIcon size={15} />}
                    立即同步
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() => void uploadNow()}
                    disabled={Boolean(webdavBusy) || !draft.webdav.url}
                    data-testid="setting-webdav-upload"
                  >
                    {webdavBusy === 'upload' ? <span className="spinner" /> : <UploadIcon size={15} />}
                    仅上传
                  </button>
                  <button
                    className="btn ghost danger-text"
                    onClick={() => setConfirmRestore(true)}
                    disabled={Boolean(webdavBusy) || !draft.webdav.url}
                    data-testid="setting-webdav-restore"
                  >
                    {webdavBusy === 'restore' ? <span className="spinner" /> : <CloudOffIcon size={15} />}
                    从远端恢复
                  </button>
                </div>
                {webdavResult && (
                  <div className={`inline-status wide ${webdavResult.ok ? 'ok' : 'bad'}`}>
                    {webdavResult.ok ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
                    {webdavResult.message}
                  </div>
                )}
                <div className="webdav-status">
                  <span>最近同步：{draft.webdav.lastSyncAt ? new Date(draft.webdav.lastSyncAt).toLocaleString() : '尚未同步'}</span>
                  {draft.webdav.lastStatus === 'error' && draft.webdav.lastError && (
                    <span className="bad">上次错误：{draft.webdav.lastError}</span>
                  )}
                </div>
                <p className="settings-note">
                  恢复 / 自动拉取会用远端待办和分组覆盖本地列表，但保留本机的 AI、快捷键与 WebDAV 设置。
                </p>
              </section>
            )}


            {tab === 'localbackup' && (
              <section className="settings-section">
                <h3>导出与本地加密备份</h3>
                <p className="settings-desc">
                  把待办导出为 Markdown（可直接分享或归档），或者导出一份用密码加密的本地备份文件，随时可以导入还原。
                </p>

                <div className="backup-card">
                  <div className="backup-card-head">
                    <FileTextIcon size={18} />
                    <div>
                      <strong>导出为 Markdown</strong>
                      <small>按分组整理，正文里的图片会写入同名 attachments 目录</small>
                    </div>
                  </div>
                  <div className="backup-actions">
                    <button
                      className="btn primary"
                      disabled={fileBusy !== null}
                      onClick={() => void runMarkdownExport(true, 'export-md')}
                      data-testid="setting-export-md-all"
                    >
                      <DownloadIcon size={15} />
                      导出全部待办
                    </button>
                    <button
                      className="btn ghost"
                      disabled={fileBusy !== null}
                      onClick={() => void runMarkdownExport(false, 'export-md')}
                      data-testid="setting-export-md-active"
                    >
                      只导出未归档
                    </button>
                  </div>
                </div>

                <div className="backup-card">
                  <div className="backup-card-head">
                    <CloudCheckIcon size={18} />
                    <div>
                      <strong>本地加密备份</strong>
                      <small>
                        使用 AES-256-GCM 加密（与 WebDAV 加密备份同格式），文件后缀 .ttbak，可随时导入还原
                      </small>
                    </div>
                  </div>
                  {isMobile ? (
                    <p className="settings-desc">
                      手机端暂不写入文件：导出的备份 JSON 会复制到剪贴板，导入时从剪贴板读取（不支持解密电脑端加密的备份）。
                    </p>
                  ) : (
                    <label className="field">
                      <span>备份密码</span>
                      <div className="input-with-action">
                        <input
                          type="password"
                          value={draft.localBackup.password}
                          onChange={(event) =>
                            setDraft((previous) => ({
                              ...previous,
                              localBackup: { ...previous.localBackup, password: event.target.value }
                            }))
                          }
                          placeholder="导出/导入本地备份时使用的密码"
                          data-testid="setting-local-backup-password"
                        />
                      </div>
                      <small>密码只保存在本机，不会写入备份文件；忘记密码将无法解密已导出的备份。</small>
                    </label>
                  )}
                  <div className="backup-actions">
                    <button
                      className="btn primary"
                      disabled={fileBusy !== null}
                      onClick={() => void runExportBackup()}
                      data-testid="setting-local-backup-export"
                    >
                      <DownloadIcon size={15} />
                      {isMobile ? '复制备份到剪贴板' : '导出加密备份'}
                    </button>
                    <button
                      className="btn ghost"
                      disabled={fileBusy !== null}
                      onClick={() => void runImportBackup()}
                      data-testid="setting-local-backup-import"
                    >
                      <UploadIcon size={15} />
                      {isMobile ? '从剪贴板导入' : '从备份文件导入'}
                    </button>
                  </div>
                  <div className="backup-meta">
                    <span>
                      最近备份：
                      {draft.localBackup.lastBackupAt
                        ? new Date(draft.localBackup.lastBackupAt).toLocaleString()
                        : '尚未备份'}
                    </span>
                    <span className="backup-warn">
                      <AlertIcon size={12} />
                      导出的 Markdown 与备份都包含你写下的全部内容，请自行保管
                    </span>
                  </div>
                </div>
              </section>
            )}

            {tab === 'security' && (
              <section className="settings-section">
                <h3>管理员密码与自动锁定</h3>
                <p className="settings-desc">
                  设置密码后，应用空闲超过设定时间会自动锁定，锁定后需输入密码解锁；便签窗口会在锁定时隐藏。
                </p>
                <div className="password-fields">
                  {hasPassword && (
                    <label className="field">
                      <span>当前密码</span>
                      <input
                        type="password"
                        value={passwordDraft.current}
                        onChange={(event) =>
                          setPasswordDraft((previous) => ({ ...previous, current: event.target.value }))
                        }
                        data-testid="setting-security-current"
                      />
                    </label>
                  )}
                  <div className="two-fields">
                    <label className="field">
                      <span>{hasPassword ? '新密码' : '设置密码'}</span>
                      <input
                        type="password"
                        value={passwordDraft.next}
                        onChange={(event) =>
                          setPasswordDraft((previous) => ({ ...previous, next: event.target.value }))
                        }
                        placeholder="至少 4 位"
                        data-testid="setting-security-next"
                      />
                    </label>
                    <label className="field">
                      <span>确认新密码</span>
                      <input
                        type="password"
                        value={passwordDraft.confirm}
                        onChange={(event) =>
                          setPasswordDraft((previous) => ({ ...previous, confirm: event.target.value }))
                        }
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') void submitPassword('set')
                        }}
                        data-testid="setting-security-confirm"
                      />
                    </label>
                  </div>
                </div>
                <div className="settings-inline">
                  <button
                    className="btn primary small"
                    onClick={() => void submitPassword('set')}
                    disabled={passwordBusy || (!hasPassword && passwordDraft.next.length < 4)}
                    data-testid="setting-security-submit"
                  >
                    {passwordBusy ? <span className="spinner" /> : <LockIcon size={14} />}
                    {hasPassword ? '修改密码' : '设置密码'}
                  </button>
                  {hasPassword && (
                    <button
                      className="btn danger small"
                      onClick={() => void submitPassword('clear')}
                      disabled={passwordBusy || !passwordDraft.current}
                      data-testid="setting-security-clear"
                    >
                      清除密码
                    </button>
                  )}
                </div>
                <label className="field">
                  <span>自动锁定</span>
                  <Dropdown
                    value={String(draft.security.autoLockMinutes)}
                    options={AUTO_LOCK_OPTIONS}
                    onChange={(next) =>
                      setDraft((previous) => ({
                        ...previous,
                        security: { ...previous.security, autoLockMinutes: Number(next) }
                      }))
                    }
                    testId="setting-autolock"
                  />
                  <small>设置管理员密码后生效；点击「保存设置」保存该项。</small>
                </label>
                <div className="settings-inline">
                  <button
                    className="btn ghost"
                    onClick={() => void lockNow()}
                    disabled={!hasPassword}
                    data-testid="setting-lock-now"
                  >
                    <LockIcon size={15} />
                    立即锁定
                  </button>
                  <span className="muted">锁定后可按全局快捷键或点击托盘图标唤起输入密码。</span>
                </div>

                <div className="danger-zone">
                  <h4>重置应用</h4>
                  <p>
                    清空全部待办、分组与设置（AI 接口、WebDAV、管理员密码均会被清除，且不可恢复）。远端 WebDAV 备份不会被删除。
                  </p>
                  <button
                    className="btn danger"
                    onClick={() => setConfirmReset(true)}
                    data-testid="setting-reset-open"
                  >
                    <TrashIcon size={15} />
                    重置应用…
                  </button>
                </div>
              </section>
            )}

            {tab === 'mcp' && (
              <section className="settings-section">
                <h3>MCP 接入</h3>
                <p className="settings-desc">
                  其他 Agent 可以通过 MCP 搜索、新增、修改、开始、完成和归档待办。归档事项默认不会返回给 Agent。
                </p>
                <div className="mcp-card">
                  <div className="mcp-card-head">
                    <strong>stdio 配置</strong>
                    <button
                      className="tiny-btn"
                      onClick={() => {
                        if (mcpInfo) {
                          void window.api.copyText(mcpInfo.config)
                          onToast('MCP 配置已复制', 'success')
                        }
                      }}
                      data-testid="setting-mcp-copy"
                    >
                      <CopyIcon size={15} />
                      复制
                    </button>
                  </div>
                  <pre data-testid="setting-mcp-config">{mcpInfo?.config ?? '正在读取…'}</pre>
                </div>
                <div className="mcp-tools">
                  {[
                    'list_todos / search_todos / get_todo',
                    'add_todo / update_todo',
                    'start_todo / complete_todo',
                    'archive_todo / restore_todo',
                    'list_groups / add_group / update_group',
                    'record_focus / get_overview'
                  ].map((item) => (
                    <span key={item}>{item}</span>
                  ))}
                </div>
                <p className="settings-note">
                  数据文件：<code>{mcpInfo?.dataFile ?? '…'}</code>
                </p>
                <p className="settings-note">
                  桌面应用运行时，MCP 进程的修改会通过文件监听自动同步回界面；建议不要同时从两个 Agent 大量写入。
                </p>
              </section>
            )}

            {tab === 'about' && (
              <section className="settings-section about-section">
                <div className="about-logo">
                  <TomatoIcon size={42} />
                </div>
                <h3>番茄待办 {__APP_VERSION__}</h3>
                <p className="settings-desc">
                  桌面待办、状态分组、桌面便签、番茄专注、AI 回顾与 MCP 数据接口。
                </p>
                <div className="about-list">
                  <span>数据存储</span>
                  <code>{mcpInfo?.dataFile ?? '本地用户数据目录'}</code>
                  <span>WebDAV</span>
                  <code>仅备份待办与分组，不包含密钥</code>
                  <span>应用图标</span>
                  <code>基于 Twemoji Tomato (CC-BY 4.0) 重新设计</code>
                  <span>构建</span>
                  <code>Electron + React + Vite</code>
                </div>
                <div className="webdav-actions">
                  <button
                    className="btn primary"
                    data-testid="setting-check-updates"
                    disabled={updateBusy}
                    onClick={async () => {
                      setUpdateBusy(true)
                      try {
                        await onCheckUpdates()
                      } finally {
                        setUpdateBusy(false)
                      }
                    }}
                  >
                    {updateBusy ? <span className="spinner" /> : <DownloadIcon size={14} />}
                    检查更新
                  </button>
                  <button className="btn ghost" onClick={() => void window.api.openExternal('https://twemoji.twitter.com/')}>
                    <ExternalIcon size={14} />
                    Twemoji 图标来源
                  </button>
                </div>
              </section>
            )}
          </div>
        </div>

        <footer className="modal-footer settings-footer">
          <span className="settings-save-hint">修改后点击保存生效</span>
          <button className="btn ghost" onClick={onClose}>
            关闭
          </button>
          <button className="btn primary" onClick={() => void save()} disabled={saveBusy} data-testid="settings-save">
            {saveBusy ? <span className="spinner" /> : <CheckIcon size={15} />}
            {saveBusy ? '保存中…' : '保存设置'}
          </button>
        </footer>
      </Modal>

      <ConfirmDialog
        open={confirmRestore}
        title="从 WebDAV 恢复"
        message="这会用远端备份覆盖本地待办与分组（本机设置会保留）。确定继续吗？"
        confirmLabel="覆盖并恢复"
        danger
        onClose={() => setConfirmRestore(false)}
        onConfirm={() => void restoreNow()}
      />

      <Modal
        open={confirmReset}
        onClose={() => setConfirmReset(false)}
        title="重置应用"
        className="small-modal"
        testId="reset-dialog"
      >
        <div className="modal-body">
          <p className="confirm-message">
            将清空所有待办、分组与设置（含 AI、WebDAV、管理员密码），此操作不可恢复。远端 WebDAV 备份不会被删除。
          </p>
          {hasPassword && (
            <input
              className="text-input"
              type="password"
              autoFocus
              placeholder="请输入管理员密码"
              value={resetPassword}
              onChange={(event) => setResetPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void performReset()
              }}
              data-testid="reset-password"
            />
          )}
        </div>
        <footer className="modal-footer">
          <button className="btn ghost" onClick={() => setConfirmReset(false)}>
            取消
          </button>
          <button
            className="btn danger"
            onClick={() => void performReset()}
            disabled={resetBusy || (hasPassword && !resetPassword)}
            data-testid="reset-confirm"
          >
            {resetBusy ? <span className="spinner" /> : <TrashIcon size={15} />}
            确认重置
          </button>
        </footer>
      </Modal>
    </>
  )
}
