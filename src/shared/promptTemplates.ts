import { DEFAULT_PROMPT_TEMPLATE } from './defaults'
import type { AppSettings, PromptTemplate } from './types'

/** 内置默认模板的固定 id：不可编辑、不可删除，可复制 */
export const DEFAULT_TEMPLATE_ID = 'default'

export function createBuiltinPromptTemplate(): PromptTemplate {
  return {
    id: DEFAULT_TEMPLATE_ID,
    name: '默认模板',
    content: DEFAULT_PROMPT_TEMPLATE,
    builtin: true,
    createdAt: '',
    updatedAt: ''
  }
}

function newTemplateId(): string {
  return `tpl-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

/** 完整模板列表：内置默认模板 + 用户自定义模板 */
export function listPromptTemplates(settings: AppSettings): PromptTemplate[] {
  const custom = Array.isArray(settings.promptTemplates) ? settings.promptTemplates : []
  return [createBuiltinPromptTemplate(), ...custom]
}

export function findPromptTemplate(settings: AppSettings, id: string): PromptTemplate | undefined {
  return listPromptTemplates(settings).find((template) => template.id === id)
}

/** 当前生效的模板（上次 AI 回顾选中的），找不到时回退默认模板 */
export function getActivePromptTemplate(settings: AppSettings): PromptTemplate {
  return (
    findPromptTemplate(settings, settings.activePromptTemplateId) ?? createBuiltinPromptTemplate()
  )
}

/** 基于某个模板复制出新的自定义模板（调用方负责把它追加进 settings.promptTemplates） */
export function duplicatePromptTemplate(base: PromptTemplate, name?: string): PromptTemplate {
  const now = new Date().toISOString()
  return {
    id: newTemplateId(),
    name: name?.trim() || `${base.name} 副本`,
    content: base.content,
    createdAt: now,
    updatedAt: now
  }
}

/** 更新自定义模板；内置模板不会被修改 */
export function updatePromptTemplate(
  settings: AppSettings,
  id: string,
  changes: { name?: string; content?: string }
): PromptTemplate[] | null {
  if (id === DEFAULT_TEMPLATE_ID) return null
  const custom = Array.isArray(settings.promptTemplates) ? [...settings.promptTemplates] : []
  const index = custom.findIndex((template) => template.id === id)
  if (index === -1) return null
  const previous = custom[index]
  custom[index] = {
    ...previous,
    name: changes.name !== undefined ? changes.name.trim() || previous.name : previous.name,
    content: changes.content !== undefined ? changes.content : previous.content,
    updatedAt: new Date().toISOString()
  }
  return custom
}

/** 删除自定义模板；删除当前选中的模板时回退默认模板 */
export function deletePromptTemplate(
  settings: AppSettings,
  id: string
): { promptTemplates: PromptTemplate[]; activePromptTemplateId: string } | null {
  if (id === DEFAULT_TEMPLATE_ID) return null
  const custom = Array.isArray(settings.promptTemplates) ? [...settings.promptTemplates] : []
  const index = custom.findIndex((template) => template.id === id)
  if (index === -1) return null
  custom.splice(index, 1)
  return {
    promptTemplates: custom,
    activePromptTemplateId: settings.activePromptTemplateId === id ? DEFAULT_TEMPLATE_ID : settings.activePromptTemplateId
  }
}
