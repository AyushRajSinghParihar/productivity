'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { getSettings } from './lib/settings'
import { getEffectiveDate } from './lib/settings'
import { playNotificationSound } from './lib/audio'
import { saveSession } from './lib/history'
import SessionHistory from './components/SessionHistory'

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export default function Dashboard() {
  const [tasks, setTasks]               = useState([])
  const [sessionStart, setSessionStart] = useState(null)
  const [skipOffset, setSkipOffset]     = useState(0)
  const [now, setNow]                   = useState(null)
  const [mounted, setMounted]           = useState(false)
  const [flashing, setFlashing]         = useState(false)
  const [settings, setSettings]         = useState(null)

  const notifiedTaskRef = useRef(null)
  const sessionSavedRef = useRef(false)
  const defaultTitle    = useRef('Focus Board')

  // Hydrate on client only
  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    setSettings(getSettings())

    const raw = localStorage.getItem('focusboard-tasks')
    if (raw) setTasks(JSON.parse(raw))

    const sess = localStorage.getItem('focusboard-session')
    if (sess) setSessionStart(Number(sess))

    const skip = localStorage.getItem('focusboard-skip-offset')
    if (skip) setSkipOffset(Number(skip))

    // Poll localStorage every 2s for cross-page sync
    const poll = setInterval(() => {
      const r = localStorage.getItem('focusboard-tasks')
      if (r) setTasks(JSON.parse(r))
      const s = localStorage.getItem('focusboard-session')
      setSessionStart(s ? Number(s) : null)
      const sk = localStorage.getItem('focusboard-skip-offset')
      setSkipOffset(sk ? Number(sk) : 0)
      setSettings(getSettings())
    }, 2000)

    const tick = setInterval(() => setNow(Date.now()), 1000)

    return () => {
      clearInterval(tick)
      clearInterval(poll)
      document.title = defaultTitle.current
    }
  }, [])

  // Compute current state
  const validTasks = tasks.filter(t => t.text?.trim())
  const breaksEnabled = settings?.breaksEnabled ?? false
  const breakDuration = (settings?.breakDuration ?? 5) * 60 // seconds

  let currentTask   = null
  let secondsLeft   = 0
  let nextTask      = null
  let isOnBreak     = false
  let allDone       = false
  let currentTaskIdx = -1

  if (sessionStart && validTasks.length > 0 && now) {
    let elapsed = Math.floor((now - sessionStart) / 1000) + skipOffset
    let cursor  = 0

    for (let i = 0; i < validTasks.length; i++) {
      const task = validTasks[i]

      // Skip completed tasks (manually checked off)
      if (task.completed) continue

      const dur = task.duration * 60

      // Check if we're in this task's time slot
      if (elapsed < cursor + dur) {
        currentTask    = task
        currentTaskIdx = i
        secondsLeft    = cursor + dur - elapsed
        // Find next non-completed task
        for (let j = i + 1; j < validTasks.length; j++) {
          if (!validTasks[j].completed) { nextTask = validTasks[j]; break }
        }
        break
      }
      cursor += dur

      // Check if we're in a break after this task
      if (breaksEnabled && nextNonCompleted(validTasks, i) !== null) {
        if (elapsed < cursor + breakDuration) {
          isOnBreak   = true
          secondsLeft = cursor + breakDuration - elapsed
          // Next task is the one after the break
          const nextIdx = nextNonCompleted(validTasks, i)
          if (nextIdx !== null) {
            currentTask    = validTasks[nextIdx]
            currentTaskIdx = nextIdx
          }
          break
        }
        cursor += breakDuration
      }
    }

    if (!currentTask && !isOnBreak) {
      allDone = true
    }
  }

  // Auto-mark task completed when timer expires
  useEffect(() => {
    if (!sessionStart || !now || !validTasks.length) return

    let elapsed = Math.floor((now - sessionStart) / 1000) + skipOffset
    let cursor  = 0

    for (let i = 0; i < validTasks.length; i++) {
      const task = validTasks[i]
      if (task.completed) continue
      const dur = task.duration * 60
      if (elapsed >= cursor + dur) {
        // This task's time has passed — mark completed if not already
        if (!task.completed) {
          const updated = tasks.map(t =>
            t.id === task.id ? { ...t, completed: true } : t
          )
          setTasks(updated)
          localStorage.setItem('focusboard-tasks', JSON.stringify(updated))
        }
        cursor += dur
        if (breaksEnabled) cursor += breakDuration
      } else {
        break
      }
    }
  }, [now, sessionStart, skipOffset])

  // Notification when task time runs out
  useEffect(() => {
    if (!currentTask || !settings) return

    // Notify when secondsLeft hits 0 or transitions to a new task
    if (secondsLeft <= 1 && notifiedTaskRef.current !== currentTask.id) {
      notifiedTaskRef.current = currentTask.id
      if (settings.notificationSound) playNotificationSound()
      if (settings.notificationFlash) {
        setFlashing(true)
        setTimeout(() => setFlashing(false), 1600)
      }
    }
  }, [secondsLeft, currentTask, settings])

  // Update tab title
  useEffect(() => {
    if (!mounted) return
    if (currentTask && secondsLeft > 0) {
      if (isOnBreak) {
        document.title = `Break ${formatCountdown(secondsLeft)} | Focus Board`
      } else {
        document.title = `${formatCountdown(secondsLeft)} \u2014 ${currentTask.text} | Focus Board`
      }
    } else if (allDone) {
      document.title = 'All Done! | Focus Board'
    } else {
      document.title = defaultTitle.current
    }
  }, [secondsLeft, currentTask, isOnBreak, allDone, mounted])

  // Save session to history when all done
  useEffect(() => {
    if (allDone && sessionStart && !sessionSavedRef.current) {
      sessionSavedRef.current = true
      const effectiveDate = getEffectiveDate(settings)
      saveSession({
        id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
        date: effectiveDate.toISOString().split('T')[0],
        startTime: sessionStart,
        endTime: Date.now(),
        tasks: validTasks.map(t => ({
          text: t.text,
          duration: t.duration,
          completed: true,
          skipped: false,
        })),
        totalTasks: validTasks.length,
        completedTasks: validTasks.length,
        totalMinutes: validTasks.reduce((s, t) => s + t.duration, 0),
      })
    }
  }, [allDone, sessionStart])

  // Reset saved flag when session changes
  useEffect(() => {
    sessionSavedRef.current = false
  }, [sessionStart])

  const handleSkip = useCallback(() => {
    if (!currentTask) return
    const newOffset = skipOffset + secondsLeft
    setSkipOffset(newOffset)
    localStorage.setItem('focusboard-skip-offset', String(newOffset))

    // Mark skipped task as completed
    const updated = tasks.map(t =>
      t.id === currentTask.id ? { ...t, completed: true } : t
    )
    setTasks(updated)
    localStorage.setItem('focusboard-tasks', JSON.stringify(updated))
    notifiedTaskRef.current = null
  }, [currentTask, skipOffset, secondsLeft, tasks])

  if (!mounted) return null

  // ── No session yet ──────────────────────────────────────────────────
  if (!sessionStart) {
    const hasTasks = validTasks.length > 0
    const totalMin = validTasks.reduce((s, t) => s + Number(t.duration), 0)

    return (
      <div className={`min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-6 ${flashing ? 'flash-notification' : ''}`}>
        {hasTasks ? (
          <>
            <p className="text-[var(--text-dim)] text-2xl uppercase tracking-widest">Ready to focus</p>
            <div className="max-w-md w-full px-6 space-y-2 mb-4">
              {validTasks.map((t, i) => (
                <div key={t.id} className="flex items-center gap-3 text-[var(--text-muted)]">
                  <span className="text-[var(--text-dim)] w-5 text-right text-xs">{i + 1}</span>
                  <span className="flex-1 text-sm">{t.text}</span>
                  <span className="text-[var(--text-dim)] text-xs">{t.duration}m</span>
                </div>
              ))}
              <p className="text-[var(--text-dim)] text-xs text-center mt-3">
                {validTasks.length} task{validTasks.length !== 1 ? 's' : ''} &middot; {totalMin} min
              </p>
            </div>
            <Link
              href="/manage"
              className="border border-[var(--border)] hover:border-[var(--text)] text-[var(--text)] px-8 py-3 rounded-full text-lg transition-colors"
            >
              Start Session &rarr;
            </Link>
          </>
        ) : (
          <>
            <p className="text-[var(--text-dim)] text-2xl uppercase tracking-widest">No tasks planned</p>
            <p className="text-[var(--text-muted)] text-base">Add some tasks to get started</p>
            <Link
              href="/manage"
              className="border border-[var(--border)] hover:border-[var(--text)] text-[var(--text)] px-8 py-3 rounded-full text-lg transition-colors"
            >
              Plan your day &rarr;
            </Link>
          </>
        )}
        <SessionHistory />
      </div>
    )
  }

  // ── All done ────────────────────────────────────────────────────────
  if (allDone) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-6">
        <p
          className="font-black uppercase text-[var(--text)] leading-none text-center"
          style={{ fontSize: 'clamp(3rem, 12vw, 10rem)' }}
        >
          ALL DONE
        </p>
        <p className="text-[var(--text-muted)] text-2xl">You crushed it today</p>
        <Link
          href="/manage"
          className="border border-[var(--border)] hover:border-[var(--text)] text-[var(--text)] px-8 py-3 rounded-full text-lg transition-colors mt-4"
        >
          Plan tomorrow &rarr;
        </Link>
        <SessionHistory />
      </div>
    )
  }

  // ── Break state ───────────────────────────────────────────────────
  if (isOnBreak) {
    return (
      <div className={`min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none ${flashing ? 'flash-notification' : ''}`}>
        <div className="absolute top-0 left-0 h-1 bg-[var(--bg-hover)] w-full">
          <div
            className="h-full transition-all duration-1000 bg-[var(--success)]"
            style={{ width: `${((breakDuration - secondsLeft) / breakDuration) * 100}%` }}
          />
        </div>

        <p className="text-[var(--success)] text-sm uppercase tracking-[0.4em] mb-6">Break Time</p>

        <h1
          className="font-black uppercase text-[var(--success)] leading-none text-center px-6"
          style={{ fontSize: 'clamp(2.5rem, 9vw, 8rem)' }}
        >
          RELAX
        </h1>

        <p
          className="font-mono font-bold mt-8 tabular-nums text-[var(--success)]"
          style={{ fontSize: 'clamp(2rem, 6vw, 4.5rem)' }}
        >
          {formatCountdown(secondsLeft)}
        </p>

        {currentTask && (
          <p className="text-[var(--text-dim)] text-lg uppercase tracking-widest mt-10">
            Next &rarr; {currentTask.text}
          </p>
        )}

        <button
          onClick={handleSkip}
          className="mt-8 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Skip break
        </button>

        <Link
          href="/manage"
          className="absolute bottom-6 right-6 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm transition-colors"
        >
          manage
        </Link>
      </div>
    )
  }

  // ── Active task ─────────────────────────────────────────────────────
  const urgency    = secondsLeft < 120
  const taskDurSec = currentTask.duration * 60
  const progress   = ((taskDurSec - secondsLeft) / taskDurSec) * 100

  return (
    <div className={`min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none ${flashing ? 'flash-notification' : ''}`}>
      {/* progress bar at top */}
      <div className="absolute top-0 left-0 h-1 bg-[var(--bg-hover)] w-full">
        <div
          className={`h-full transition-all duration-1000 ${urgency ? 'bg-[var(--danger)]' : 'bg-[var(--text)]'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      {/* label */}
      <p className="text-[var(--text-dim)] text-sm uppercase tracking-[0.4em] mb-6">Right now</p>

      {/* BIG task name */}
      <h1
        className={`font-black uppercase leading-none text-center px-6 ${urgency ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}
        style={{ fontSize: 'clamp(2.5rem, 9vw, 8rem)', wordBreak: 'break-word', maxWidth: '90vw' }}
      >
        {currentTask.text}
      </h1>

      {/* countdown */}
      <p
        className={`font-mono font-bold mt-8 tabular-nums ${urgency ? 'text-[var(--danger)]' : 'text-[var(--accent)]'}`}
        style={{ fontSize: 'clamp(2rem, 6vw, 4.5rem)' }}
      >
        {formatCountdown(secondsLeft)}
      </p>

      {/* skip + next */}
      <div className="flex flex-col items-center mt-10 gap-4">
        <button
          onClick={handleSkip}
          className="text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Skip &rarr;
        </button>

        {nextTask && (
          <p className="text-[var(--text-dim)] text-lg uppercase tracking-widest">
            Next &rarr; {nextTask.text}
          </p>
        )}
      </div>

      {/* manage link */}
      <Link
        href="/manage"
        className="absolute bottom-6 right-6 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm transition-colors"
      >
        manage
      </Link>
    </div>
  )
}

function nextNonCompleted(tasks, afterIndex) {
  for (let i = afterIndex + 1; i < tasks.length; i++) {
    if (!tasks[i].completed) return i
  }
  return null
}
