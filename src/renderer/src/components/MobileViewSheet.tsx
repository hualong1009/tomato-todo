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
  PlusIcon
} from './Icons'
import type { ViewKey } from './Sidebar'

interface MobileViewSheetProps {
  state: AppState
  view: ViewKey
  onView: (view: ViewKey) => void
  onAddGroup: () => void
  onGroupMenu: (event: React.MouseEvent, groupId: string) => void
}

const STATUS_VIEWS: { key: ViewKey; label: string; icon: React.ReactNode; tone: string }[] = [
  { key: 'all', label: '全部', icon: <LayersIcon size={16} />, tone: 'all' },
  { key: 'not_started', label: '未开始', icon: <ClockIcon size={16} />, tone: 'not_started' },
  { key: 'in_progress', label: '进行中', icon: <FlameIcon size={16} />, tone: 'in_progress' },
  { key: 'overdue', label: '未完成', icon: <AlertIcon size={16} />, tone: 'overdue' },
  { key: 'completed', label: '已完成', icon: <CheckIcon size={16} />, tone: 'completed' },
  { key: 'archived', label: '归档', icon: <ArchiveIcon size={16} />, tone: 'archived' }
]

/** 移动端视图 / 分组选择面板。 */
export function MobileViewSheet({
  state,
  view,
  onView,
  onAddGroup,
  onGroupMenu
}: MobileViewSheetProps) {
  const now = Date.now()
  const active = state.todos.filter((todo) => !todo.archivedAt)
  const counts: Record<string, number> = {
    all: active.length,
    not_started: active.filter((todo) => !todo.startedAt && !todo.completedAt).length,
    in_progress: active.filter((todo) => todo.startedAt && !todo.completedAt).length,
    overdue: active.filter((todo) => isOverdue(todo, now)).length,
    completed: active.filter((todo) => Boolean(todo.completedAt)).length,
    archived: state.todos.filter((todo) => Boolean(todo.archivedAt)).length
  }

  return (
    <div className="mobile-views">
      <div className="mobile-view-grid">
        {STATUS_VIEWS.map((item) => (
          <button
            key={item.key}
            className={`mobile-view-chip tone-${item.tone} ${view === item.key ? 'active' : ''}`}
            onClick={() => onView(item.key)}
            data-testid={`mobile-view-${item.key}`}
          >
            {item.icon}
            <span>{item.label}</span>
            <strong>{counts[item.key] ?? 0}</strong>
          </button>
        ))}
      </div>

      <div className="mobile-view-section">
        <div className="mobile-view-section-head">
          <span>分组</span>
          <button className="btn ghost small" onClick={onAddGroup} data-testid="mobile-add-group">
            <PlusIcon size={14} />
            新建
          </button>
        </div>
        <div className="mobile-group-list">
          {state.groups.map((group) => {
            const count = active.filter((todo) => todo.groupId === group.id).length
            const key: ViewKey = `group:${group.id}`
            return (
              <div key={group.id} className={`mobile-group-row ${view === key ? 'active' : ''}`}>
                <button
                  className="mobile-group-main"
                  onClick={() => onView(key)}
                  data-testid={`mobile-group-${group.id}`}
                >
                  <i className="mobile-group-dot" style={{ background: group.color }} />
                  <span className="mobile-group-name">{group.name}</span>
                  <span className="mobile-group-count">{count}</span>
                </button>
                <button
                  className="icon-btn mobile-group-more"
                  aria-label="分组操作"
                  onClick={(event) => onGroupMenu(event, group.id)}
                  data-testid={`mobile-group-more-${group.id}`}
                >
                  <MoreIcon size={16} />
                </button>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
