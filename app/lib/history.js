const STORAGE_KEY = 'focusboard-history'

export function getHistory() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : []
  } catch {
    return []
  }
}

export function saveSession(session) {
  const history = getHistory()
  history.unshift(session)
  // Keep last 100 sessions to avoid localStorage bloat
  if (history.length > 100) history.length = 100
  localStorage.setItem(STORAGE_KEY, JSON.stringify(history))
}

export function clearHistory() {
  localStorage.removeItem(STORAGE_KEY)
}
