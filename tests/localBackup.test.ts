import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  backupBeforeImport,
  normaliseMarkdownPath,
  readLocalBackupFile,
  writeLocalBackupFile,
  writeMarkdownExport
} from '../src/main/localBackup'
import { archiveTodo, createGroup, createTodo, updateTodo } from '../src/shared/operations'
import { parseRemotePayload } from '../src/shared/backup'
import { makeState } from './helpers'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'tt-backup-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('normaliseMarkdownPath', () => {
  it('没有扩展名时补 .md', () => {
    expect(normaliseMarkdownPath(join(dir, 'export'))).toBe(join(dir, 'export.md'))
    expect(normaliseMarkdownPath(join(dir, 'export.md'))).toBe(join(dir, 'export.md'))
  })
})

describe('writeMarkdownExport', () => {
  it('导出 Markdown 文件并含元信息表格', () => {
    const state = makeState()
    createTodo(state, { title: '导出任务', content: '正文内容', groupId: 'inbox' })
    const result = writeMarkdownExport(join(dir, 'export'), state, null)

    expect(result.path.endsWith('.md')).toBe(true)
    const markdown = readFileSync(result.path, 'utf8')
    expect(markdown).toContain('# 番茄待办导出')
    expect(markdown).toContain('## 📌 导出任务')
    expect(markdown).toContain('| 状态 |')
    expect(markdown).toContain('### 详细内容')
    expect(result.todoCount).toBe(1)
    expect(result.imageCount).toBe(0)
  })

  it('内嵌图片写入 attachments 目录并改写链接', () => {
    const pngBase64 =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='
    const state = makeState()
    createTodo(state, {
      title: '带图任务',
      content: `前文\n\n![截图](data:image/png;base64,${pngBase64})\n\n后文`,
      groupId: 'inbox'
    })
    const result = writeMarkdownExport(join(dir, 'shot.md'), state, null)

    const markdown = readFileSync(result.path, 'utf8')
    expect(markdown).toContain('![截图](./attachments/g1-image-1.png)')
    expect(markdown).not.toContain('base64')
    expect(result.imageCount).toBe(1)
    const png = readFileSync(join(dir, 'attachments', 'g1-image-1.png'))
    // 重新按 base64 编码应与原始数据一致
    expect(png.toString('base64')).toBe(pngBase64)
  })

  it('只导出指定待办', () => {
    const state = makeState()
    createTodo(state, { title: '任务甲', groupId: 'inbox' })
    const second = createTodo(state, { title: '任务乙', groupId: 'inbox' })
    const result = writeMarkdownExport(join(dir, 'one.md'), state, [second.id])
    expect(result.todoCount).toBe(1)
    expect(readFileSync(result.path, 'utf8')).toContain('任务乙')
    expect(readFileSync(result.path, 'utf8')).not.toContain('任务甲')
  })

  it('includeArchived=false 时跳过归档待办', () => {
    const state = makeState()
    createTodo(state, { title: '普通任务', groupId: 'inbox' })
    const target = createTodo(state, { title: '归档任务', groupId: 'inbox' })
    archiveTodo(state, target.id)

    const result = writeMarkdownExport(join(dir, 'no-arch.md'), state, null, {
      includeArchived: false
    })
    const markdown = readFileSync(result.path, 'utf8')
    expect(markdown).toContain('普通任务')
    expect(markdown).not.toContain('归档任务')
  })
  it('附件随 Markdown 一起落到 attachments 目录', () => {
    const state = makeState()
    const todo = createTodo(state, { title: '带附件任务', groupId: 'inbox' })
    updateTodo(state, todo.id, {
      attachments: [
        {
          id: 'att-1',
          name: '报告.pdf',
          mime: 'application/pdf',
          size: 6,
          data: 'data:application/pdf;base64,JVBERi0xLjQK',
          createdAt: '2026-01-01T00:00:00.000Z'
        }
      ]
    })
    const result = writeMarkdownExport(join(dir, 'with-files.md'), state, null)
    expect(result.attachmentCount).toBe(1)
    const markdown = readFileSync(result.path, 'utf8')
    expect(markdown).toContain('### 附件')
    expect(markdown).toContain('[报告.pdf](./attachments/')
    const files = readdirSync(join(dir, 'attachments'))
    expect(files.some((name) => name.includes('报告.pdf'))).toBe(true)
  })

})

describe('writeLocalBackupFile / readLocalBackupFile', () => {
  it('明文备份往返', () => {
    const state = makeState()
    createTodo(state, { title: '备份任务', groupId: 'inbox' })
    const result = writeLocalBackupFile(join(dir, 'plain'), state, '')

    expect(result.encrypted).toBe(false)
    const payload = readLocalBackupFile(result.path, '')
    expect(payload.todos.some((todo) => todo.title === '备份任务')).toBe(true)
  })

  it('加密备份（TTENC2）往返，且可用 WebDAV 解析逻辑读取', () => {
    const state = makeState()
    const group = createGroup(state, '项目组')
    createTodo(state, { title: '加密任务', content: '秘密内容', groupId: group.id })
    const result = writeLocalBackupFile(join(dir, 'secret.ttbak'), state, 'pw-123')

    expect(result.encrypted).toBe(true)
    const raw = readFileSync(result.path)
    expect(raw.subarray(0, 6).toString('utf8')).toBe('TTENC2')
    expect(result.size).toBe(statSync(result.path).size)

    const payload = readLocalBackupFile(result.path, 'pw-123')
    expect(payload.todos.some((todo) => todo.title === '加密任务')).toBe(true)
    expect(payload.groups.some((item) => item.name === '项目组')).toBe(true)

    // 与 WebDAV 加密备份同一格式：解密结果可被 parseRemotePayload 解析
    const decrypted = readLocalBackupFile(result.path, 'pw-123')
    expect(parseRemotePayload(JSON.stringify(decrypted))?.todos.length).toBe(payload.todos.length)
  })

  it('密码错误时解密失败', () => {
    const state = makeState()
    createTodo(state, { title: '任务', groupId: 'inbox' })
    const result = writeLocalBackupFile(join(dir, 'a.ttbak'), state, '正确密码')
    expect(() => readLocalBackupFile(result.path, '错误密码')).toThrow()
  })

  it('加密备份缺少密码时报错', () => {
    const state = makeState()
    createTodo(state, { title: '任务', groupId: 'inbox' })
    const result = writeLocalBackupFile(join(dir, 'b.ttbak'), state, '密码')
    expect(() => readLocalBackupFile(result.path, '')).toThrow(/密码/)
  })

  it('无效内容报错', () => {
    const file = join(dir, 'bad.ttbak')
    writeFileSync(file, 'not-json{{', 'utf8')
    expect(() => readLocalBackupFile(file, '')).toThrow(/有效/)
  })
})

describe('backupBeforeImport', () => {
  it('导入前复制原文件', () => {
    const file = join(dir, 'data.json')
    writeFileSync(file, '{"a":1}', 'utf8')
    const copy = backupBeforeImport(file)
    expect(copy).not.toBeNull()
    expect(readFileSync(copy as string, 'utf8')).toBe('{"a":1}')
  })

  it('文件不存在时返回 null', () => {
    expect(backupBeforeImport(join(dir, 'missing.json'))).toBeNull()
  })
})

