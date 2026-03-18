'use client'
import { useState, useEffect } from 'react'
import { getHistory, clearHistory } from '../lib/history'

export default function SessionHistory() {
  const [history, setHistory] = useState([])
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    setHistory(getHistory())
  }, [])

  if (history.length === 0) return null

  const grouped = {}
  for (const session of history) {
    const dateKey = session.date
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(session)
  }

  const handleClear = () => {
    clearHistory()
    setHistory([])
  }

  return (
    <div className="w-full max-w-2xl mx-auto px-6 mt-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 text-[var(--text-muted)] hover:text-[var(--text)] text-sm transition-colors"
      >
        <span className={`transition-transform ${expanded ? 'rotate-90' : ''}`}>&#9654;</span>
        Past Sessions ({history.length})
      </button>

      {expanded && (
        <div className="mt-4 space-y-4">
          {Object.entries(grouped).map(([date, sessions]) => (
            <div key={date} className="border border-[var(--border)] rounded-xl p-4">
              <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest mb-3">
                {formatDate(date)}
              </p>
              {sessions.map((session) => (
                <div key={session.id} className="mb-3 last:mb-0">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[var(--text-dim)] text-xs">
                      {formatTime(session.startTime)} &mdash; {formatTime(session.endTime)}
                    </span>
                    <span className="text-[var(--text-muted)] text-xs">
                      {session.completedTasks}/{session.totalTasks} tasks &middot; {session.totalMinutes} min
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {session.tasks.map((t, i) => (
                      <span
                        key={i}
                        className={`text-xs px-2 py-0.5 rounded-full border ${
                          t.completed
                            ? 'border-[var(--success)]/30 text-[var(--success)]'
                            : 'border-[var(--border)] text-[var(--text-dim)]'
                        }`}
                      >
                        {t.completed ? '\u2713 ' : ''}{t.text}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ))}

          <button
            onClick={handleClear}
            className="text-[var(--text-dim)] hover:text-[var(--danger)] text-xs transition-colors"
          >
            Clear history
          </button>
        </div>
      )}
    </div>
  )
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString('en-US', {
      weekday: 'long', month: 'long', day: 'numeric'
    })
  } catch {
    return isoString
  }
}

function formatTime(timestamp) {
  try {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}
