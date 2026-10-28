import type { Todo } from '@shared/types'
import { useBackDismiss } from '../platform/backNavigation'
import { formatClock } from '../utils/format'
import {
  CoffeeIcon,
  PauseIcon,
  PlayIcon,
  ResetIcon,
  SkipIcon,
  TimerIcon,
  TomatoIcon,
  XIcon
} from './Icons'

export interface PomodoroState {
  todoId: string
  phase: 'focus' | 'break'
  total: number
  remaining: number
  running: boolean
  endsAt: number | null
  completedFocus: number
}

interface PomodoroOverlayProps {
  session: PomodoroState
  todo?: Todo
  onToggleRun: () => void
  onReset: () => void
  onSkip: () => void
  onClose: () => void
  onCollapse: () => void
}

export function PomodoroOverlay({
  session,
  todo,
  onToggleRun,
  onReset,
  onSkip,
  onClose,
  onCollapse
}: PomodoroOverlayProps) {
  const focus = session.phase === 'focus'
  const progress = Math.min(1, Math.max(0, 1 - session.remaining / session.total))
  const radius = 112
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - progress)

  // 手机端返回键收起为迷你计时器，不中断本次专注
  useBackDismiss(true, onCollapse)

  return (
    <div className="pomodoro-backdrop">
      <div className={`pomodoro-modal ${focus ? 'focus' : 'break'}`} data-testid="pomodoro-overlay">
        <div className="pomodoro-stars" />
        <header className="pomodoro-header">
          <div className="pomodoro-mode">
            {focus ? <TomatoIcon size={18} /> : <CoffeeIcon size={18} />}
            {focus ? 'FOCUS MODE' : 'BREAK MODE'}
          </div>
          <div className="pomodoro-header-actions">
            <button className="tiny-btn" onClick={onCollapse} title="收起为迷你计时器" data-testid="pomodoro-collapse">
              <TimerIcon size={16} />
            </button>
            <button className="tiny-btn" onClick={onClose} title="结束本次专注" data-testid="pomodoro-close">
              <XIcon size={16} />
            </button>
          </div>
        </header>

        <div className="pomodoro-content">
          <div className="pomodoro-ring-wrap">
            <svg className="pomodoro-ring" viewBox="0 0 260 260">
              <circle className="ring-track" cx="130" cy="130" r={radius} />
              <circle
                className="ring-progress"
                cx="130"
                cy="130"
                r={radius}
                strokeDasharray={circumference}
                strokeDashoffset={offset}
              />
            </svg>
            <div className="pomodoro-time-wrap">
              <div className="pomodoro-time" data-testid="pomodoro-time">
                {formatClock(session.remaining)}
              </div>
              <div className="pomodoro-phase">{focus ? '保持专注' : '放松一下'}</div>
            </div>
          </div>

          <div className="pomodoro-task">
            <span className="pomodoro-task-label">{focus ? '当前专注' : '休息提示'}</span>
            <h2>{focus ? todo?.title ?? '专注任务' : '离开屏幕，活动一下肩颈'}</h2>
            {focus && todo?.content && <p>{todo.content.replace(/\s+/g, ' ').slice(0, 120)}</p>}
          </div>

          <div className="pomodoro-controls">
            <button className="pomo-control secondary" onClick={onReset} title="重置本阶段">
              <ResetIcon size={18} />
            </button>
            <button className="pomo-control main" onClick={onToggleRun} data-testid="pomodoro-toggle">
              {session.running ? <PauseIcon size={26} /> : <PlayIcon size={26} />}
            </button>
            <button className="pomo-control secondary" onClick={onSkip} title="跳过本阶段">
              <SkipIcon size={18} />
            </button>
          </div>

          <div className="pomodoro-stats">
            <span>
              <TomatoIcon size={14} />
              已完成 {session.completedFocus} 个专注段
            </span>
            <span>{focus ? '完成后自动记录实际专注时间' : '休息结束后可以开始下一轮'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export function PomodoroMini({
  session,
  todo,
  onOpen
}: {
  session: PomodoroState
  todo?: Todo
  onOpen: () => void
}) {
  return (
    <button
      className={`mini-timer ${session.running ? 'running' : ''} ${session.phase}`}
      onClick={onOpen}
      title="打开番茄计时器"
      data-testid="pomodoro-mini"
    >
      {session.phase === 'focus' ? <TomatoIcon size={13} /> : <CoffeeIcon size={13} />}
      <span>{formatClock(session.remaining)}</span>
      <em>{session.phase === 'focus' ? todo?.title ?? '专注' : '休息'}</em>
    </button>
  )
}
