import { getSettings, getEffectiveDate } from './settings'
import { saveSession } from './history'

const DATE_KEY = 'focusboard-tasks-date'

export function checkAndResetDay() {
  const settings = getSettings()
  const today = getEffectiveDate(settings).toISOString().split('T')[0]
  const stored = localStorage.getItem(DATE_KEY)

  if (stored === today) return false

  // Archive old session if there were completed tasks
  const raw = localStorage.getItem('focusboard-tasks')
  const sessionStart = localStorage.getItem('focusboard-session')
  if (raw) {
    const tasks = JSON.parse(raw).filter(t => t.text?.trim())
    const completed = tasks.filter(t => t.completed)
    if (completed.length > 0 && sessionStart) {
      saveSession({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        date: stored || today,
        startTime: Number(sessionStart),
        endTime: Date.now(),
        tasks: tasks.map(t => ({
          text: t.text,
          duration: t.duration,
          completed: !!t.completed,
          skipped: false,
        })),
        totalTasks: tasks.length,
        completedTasks: completed.length,
        totalMinutes: tasks.reduce((s, t) => s + t.duration, 0),
      })
    }
  }

  // Clear all session state
  localStorage.removeItem('focusboard-tasks')
  localStorage.removeItem('focusboard-session')
  localStorage.removeItem('focusboard-skip-offset')
  localStorage.removeItem('focusboard-paused-at')
  localStorage.removeItem('focusboard-manual-break')
  localStorage.removeItem('focusboard-planned-start')

  // Stamp today's date
  localStorage.setItem(DATE_KEY, today)
  return true
}

export function stampToday() {
  const settings = getSettings()
  const today = getEffectiveDate(settings).toISOString().split('T')[0]
  localStorage.setItem(DATE_KEY, today)
}
