const STORAGE_KEY = 'focusboard-settings'

const DEFAULTS = {
  theme: 'dark',
  breaksEnabled: false,
  breakDuration: 5,
  dayRolloverHour: 4,
  notificationSound: true,
  notificationFlash: true,
}

export function getSettings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return { ...DEFAULTS, ...(raw ? JSON.parse(raw) : {}) }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(partial) {
  const current = getSettings()
  const next = { ...current, ...partial }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  return next
}

export function getEffectiveDate(settings) {
  const now = new Date()
  const rollover = settings?.dayRolloverHour ?? DEFAULTS.dayRolloverHour
  if (now.getHours() < rollover) {
    const yesterday = new Date(now)
    yesterday.setDate(yesterday.getDate() - 1)
    return yesterday
  }
  return now
}
