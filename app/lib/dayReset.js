import { getSettings, getEffectiveDate } from './settings'
import { saveSession } from './history'
import {
  finalizeHistorySession,
  getStoredRuntime,
  hasRuntimeProgress,
  migrateLegacySession,
  RUNTIME_STORAGE_KEY,
} from './runtime.mjs'

const DATE_KEY = 'focusboard-tasks-date'

export function checkAndResetDay() {
  const settings = getSettings()
  const today = getEffectiveDate(settings).toISOString().split('T')[0]
  const stored = localStorage.getItem(DATE_KEY)

  const migrated = migrateLegacySession(localStorage, { date: stored || today })
  if (migrated.session) saveSession(migrated.session)

  if (stored === today) return migrated.migrated

  const runtime = getStoredRuntime(localStorage)
  if (runtime && !runtime.archivedAt && hasRuntimeProgress(runtime)) {
    const session = finalizeHistorySession(runtime, { now: Date.now(), date: stored || today })
    if (session) saveSession(session)
  }

  // Clear all session state
  localStorage.removeItem('focusboard-tasks')
  localStorage.removeItem('focusboard-planned-start')
  localStorage.removeItem('focusboard-planned-start-mode')
  localStorage.removeItem(RUNTIME_STORAGE_KEY)

  // Stamp today's date
  localStorage.setItem(DATE_KEY, today)
  return true
}

export function stampToday() {
  const settings = getSettings()
  const today = getEffectiveDate(settings).toISOString().split('T')[0]
  localStorage.setItem(DATE_KEY, today)
}
