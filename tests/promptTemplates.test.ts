import { describe, expect, it } from 'vitest'
import { DEFAULT_PROMPT_TEMPLATE } from '../src/shared/defaults'
import { normaliseState } from '../src/shared/normalise'
import {
  DEFAULT_TEMPLATE_ID,
  deletePromptTemplate,
  duplicatePromptTemplate,
  getActivePromptTemplate,
  listPromptTemplates,
  updatePromptTemplate
} from '../src/shared/promptTemplates'
import { buildSummaryContext } from '../src/shared/summary'
import type { AppState, PromptTemplate } from '../src/shared/types'
import { makeState } from './helpers'

const CUSTOM_CONTENT = '请用「{{range}}」的数据生成一句话总结：{{todos}}'

function stateWithTemplates(
  templates: PromptTemplate[],
  activePromptTemplateId: string
): AppState {
  const state = makeState()
  state.settings.promptTemplates = templates
  state.settings.activePromptTemplateId = activePromptTemplateId
  state.settings.promptTemplate =
    activePromptTemplateId === DEFAULT_TEMPLATE_ID ? DEFAULT_PROMPT_TEMPLATE : CUSTOM_CONTENT
  return normaliseState({ ...state, settings: { ...state.settings } })
}

const custom: PromptTemplate = {
  id: 'tpl-a',
  name: '周报模板',
  content: CUSTOM_CONTENT,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z'
}

describe('提示词模板管理', () => {
  it('模板列表 = 内置默认 + 自定义，默认模板带 builtin 标记', () => {
    const state = stateWithTemplates([custom], DEFAULT_TEMPLATE_ID)
    const templates = listPromptTemplates(state.settings)
    expect(templates).toHaveLength(2)
    expect(templates[0].id).toBe(DEFAULT_TEMPLATE_ID)
    expect(templates[0].builtin).toBe(true)
    expect(templates[0].content).toBe(DEFAULT_PROMPT_TEMPLATE)
    expect(templates[1].id).toBe('tpl-a')
  })

  it('选中自定义模板时 getActive 返回它，promptTemplate 镜像同步', () => {
    const state = stateWithTemplates([custom], 'tpl-a')
    expect(getActivePromptTemplate(state.settings).id).toBe('tpl-a')
    expect(state.settings.promptTemplate).toBe(CUSTOM_CONTENT)
  })

  it('选中的模板 id 不存在时回退默认', () => {
    const state = stateWithTemplates([custom], 'tpl-gone')
    expect(getActivePromptTemplate(state.settings).id).toBe(DEFAULT_TEMPLATE_ID)
    expect(state.settings.promptTemplate).toBe(DEFAULT_PROMPT_TEMPLATE)
  })

  it('复制默认模板得到可编辑的新模板', () => {
    const base = listPromptTemplates(stateWithTemplates([], DEFAULT_TEMPLATE_ID).settings)[0]
    const copy = duplicatePromptTemplate(base, '我的复盘')
    expect(copy.id).not.toBe(DEFAULT_TEMPLATE_ID)
    expect(copy.builtin).toBeUndefined()
    expect(copy.name).toBe('我的复盘')
    expect(copy.content).toBe(DEFAULT_PROMPT_TEMPLATE)
    const next = stateWithTemplates([copy], copy.id)
    expect(listPromptTemplates(next.settings)).toHaveLength(2)
    expect(getActivePromptTemplate(next.settings).id).toBe(copy.id)
  })

  it('可以修改自定义模板，但不能修改内置模板', () => {
    const state = stateWithTemplates([custom], 'tpl-a')
    const updated = updatePromptTemplate(state.settings, 'tpl-a', {
      name: '改名了',
      content: '新内容 {{total}}'
    })
    expect(updated).not.toBeNull()
    expect(updated?.[0].name).toBe('改名了')
    expect(updatePromptTemplate(state.settings, DEFAULT_TEMPLATE_ID, { content: 'x' })).toBeNull()
  })

  it('删除自定义模板时若删的是当前选中则回退默认', () => {
    const state = stateWithTemplates([custom], 'tpl-a')
    const removed = deletePromptTemplate(state.settings, 'tpl-a')
    expect(removed?.promptTemplates).toHaveLength(0)
    expect(removed?.activePromptTemplateId).toBe(DEFAULT_TEMPLATE_ID)
    expect(deletePromptTemplate(state.settings, DEFAULT_TEMPLATE_ID)).toBeNull()
  })

  it('旧版单模板数据自动迁移成自定义模板', () => {
    const state = makeState()
    // 模拟旧版数据文件：没有 promptTemplates / activePromptTemplateId 字段
    const { promptTemplates: _t, activePromptTemplateId: _a, ...legacySettings } = state.settings
    const legacy = normaliseState({
      ...state,
      settings: { ...legacySettings, promptTemplate: '我的旧模板 {{range}}' }
    })
    expect(legacy.settings.promptTemplates).toHaveLength(1)
    expect(legacy.settings.promptTemplates[0].content).toBe('我的旧模板 {{range}}')
    expect(legacy.settings.activePromptTemplateId).toBe('tpl-migrated')
    expect(legacy.settings.promptTemplate).toBe('我的旧模板 {{range}}')
  })

  it('旧版未改过的默认模板不迁移', () => {
    const state = makeState()
    const legacy = normaliseState({
      ...state,
      settings: { ...state.settings, promptTemplate: DEFAULT_PROMPT_TEMPLATE }
    })
    expect(legacy.settings.promptTemplates).toHaveLength(0)
    expect(legacy.settings.activePromptTemplateId).toBe(DEFAULT_TEMPLATE_ID)
  })

  it('AI 总结使用选中模板的提示词', () => {
    const state = stateWithTemplates([custom], 'tpl-a')
    const context = buildSummaryContext(state, 'week')
    expect(context.prompt).toContain('请用「最近 1 周」的数据生成一句话总结')
    expect(context.prompt).not.toContain('洞察敏锐')

    const defaultState = stateWithTemplates([custom], DEFAULT_TEMPLATE_ID)
    const defaultContext = buildSummaryContext(defaultState, 'week')
    expect(defaultContext.prompt).toContain('洞察敏锐')
  })
})
