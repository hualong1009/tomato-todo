import type { AppState } from '@shared/types'
import { isOverdue } from '@shared/todoUtils'
import {
  AlertIcon,
  ArchiveIcon,
  CheckIcon,
  ClockIcon,
  FlameIcon,
  LayersIcon,
  MoreIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon
} from './Icons'

export type ViewKey =
  | 'all'
  | 'not_started'
  | 'in_progress'
  | 'overdue'
  | 'completed'
  | 'archived'
  | `group:${string}`

interface SidebarProps {
  state: AppState
  view: ViewKey
  onView: (view: ViewKey) => void
  onAddGroup: () => void
  onGroupMenu: (event: React.MouseEvent, groupId: string) => void
  onOpenAI: () => void
  onOpenSettings: () => void
}

const STATUS_VIEWS: { key: ViewKey; label: string; icon: React.ReactNode; tone: string }[] = [
  { key: 'all', label: '全部待办', icon: <LayersIcon size={16} />, tone: 'all' },
  { key: 'not_started', label: '未开始', icon: <ClockIcon size={16} />, tone: 'not_started' },
  { key: 'in_progress', label: '进行中', icon: <FlameIcon size={16} />, tone: 'in_progress' },
  { key: 'overdue', label: '未完成', icon: <AlertIcon size={16} />, tone: 'overdue' },
  { key: 'completed', label: '已完成', icon: <CheckIcon size={16} />, tone: 'completed' }
]

export function Sidebar({
  state,
  view,
  onView,
  onAddGroup,
  onGroupMenu,
  onOpenAI,
  onOpenSettings
}: SidebarProps) {
  const active = state.todos.filter((todo) => !todo.archivedAt)
  const now = Date.now()
  const counts: Record<string, number> = {
    all: active.length,
    not_started: active.filter((todo) => !todo.startedAt && !todo.completedAt).length,
    in_progress: active.filter((todo) => todo.startedAt && !todo.completedAt).length,
    overdue: active.filter((todo) => isOverdue(todo, now)).length,
    completed: active.filter((todo) => Boolean(todo.completedAt)).length,
    archived: state.todos.filter((todo) => Boolean(todo.archivedAt)).length
  }
  const groupCount = (groupId: string) =>
    active.filter((todo) => todo.groupId === groupId).length

  return (
    <aside className="sidebar">
      <div className="sidebar-scroll">
        <div className="sidebar-section">
          <div className="sidebar-label">状态视图</div>
          {STATUS_VIEWS.map((item) => (
            <button
              key={item.key}
              className={`nav-item ${view === item.key ? 'active' : ''}`}
              onClick={() => onView(item.key)}
              data-testid={`view-${item.key}`}
            >
              <span className={`nav-icon tone-${item.tone}`}>{item.icon}</span>
              <span className="nav-text">{item.label}</span>
              <span className="nav-count">{counts[item.key] ?? 0}</span>
            </button>
          ))}
        </div>

        <div className="sidebar-section groups-section">
          <div className="sidebar-label-row">
            <span className="sidebar-label">我的分组</span>
            <button className="tiny-btn" onClick={onAddGroup} title="新增分组" data-testid="add-group">
              <PlusIcon size={15} />
            </button>
          </div>
          {state.groups.map((group) => (
            <div
              key={group.id}
              className={`nav-item group-nav ${view === `group:${group.id}` ? 'active' : ''}`}
              onClick={() => onView(`group:${group.id}`)}
              onContextMenu={(event) => onGroupMenu(event, group.id)}
              role="button"
              tabIndex={0}
              data-testid={`group-${group.id}`}
              onKeyDown={(event) => {
                if (event.key === 'Enter') onView(`group:${group.id}`)
              }}
            >
              <span className="group-dot" style={{ background: group.color, boxShadow: `0 0 10px ${group.color}` }} />
              <span className="nav-text">{group.name}</span>
              <span className="nav-count">{groupCount(group.id)}</span>
              <button
                className="nav-more"
                onClick={(event) => {
                  event.stopPropagation()
                  onGroupMenu(event, group.id)
                }}
                title="分组操作"
                data-testid={`group-menu-${group.id}`}
              >
                <MoreIcon size={15} />
              </button>
            </div>
          ))}
          {state.groups.length === 0 && <div className="empty-hint">还没有分组</div>}
        </div>

        <div className="sidebar-section">
          <button
            className={`nav-item ${view === 'archived' ? 'active' : ''}`}
            onClick={() => onView('archived')}
            data-testid="view-archived"
          >
            <span className="nav-icon tone-archived">
              <ArchiveIcon size={16} />
            </span>
            <span className="nav-text">已归档</span>
            <span className="nav-count">{counts.archived}</span>
          </button>
        </div>
      </div>

      <div className="sidebar-footer">
        <button className="ai-cta" onClick={onOpenAI} data-testid="open-ai">
          <span className="ai-cta-icon">
            <SparklesIcon size={18} />
          </span>
          <span>
            <strong>AI 回顾</strong>
            <small>周 / 月 / 年总结</small>
          </span>
        </button>
        <button className="sidebar-settings" onClick={onOpenSettings} data-testid="open-settings">
          <SettingsIcon size={17} />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}

