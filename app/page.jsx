'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSettings, getEffectiveDate } from './lib/settings'
import { playNotificationSound } from './lib/audio'
import { saveSession } from './lib/history'
import { checkAndResetDay } from './lib/dayReset'
import SessionHistory from './components/SessionHistory'

function formatCountdown(seconds) {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

function taskFontSize(text) {
  const len = text?.length || 0
  if (len <= 10) return 'clamp(2.5rem, 9vw, 8rem)'
  if (len <= 20) return 'clamp(2rem, 7vw, 6rem)'
  if (len <= 40) return 'clamp(1.5rem, 5vw, 4rem)'
  return 'clamp(1.2rem, 4vw, 3rem)'
}

function FullscreenBtn({ isFullscreen, onToggle }) {
  return (
    <button
      onClick={onToggle}
      className="absolute bottom-6 left-6 text-[var(--text-dim)] hover:text-[var(--text-muted)] transition-colors"
      title={isFullscreen ? 'Exit fullscreen' : 'Fullscreen'}
    >
      {isFullscreen ? (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 14 10 14 10 20" />
          <polyline points="20 10 14 10 14 4" />
          <line x1="14" y1="10" x2="21" y2="3" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      ) : (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polyline points="15 3 21 3 21 9" />
          <polyline points="9 21 3 21 3 15" />
          <line x1="21" y1="3" x2="14" y2="10" />
          <line x1="3" y1="21" x2="10" y2="14" />
        </svg>
      )}
    </button>
  )
}

export default function Dashboard() {
  const [tasks, setTasks]               = useState([])
  const [sessionStart, setSessionStart] = useState(null)
  const [skipOffset, setSkipOffset]     = useState(0)
  const [paused, setPaused]             = useState(false)
  const [pausedAt, setPausedAt]         = useState(null)
  const [manualBreak, setManualBreak]   = useState(false)
  const [now, setNow]                   = useState(null)
  const [mounted, setMounted]           = useState(false)
  const [flashing, setFlashing]         = useState(false)
  const [settings, setSettings]         = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const router = useRouter()
  const notifiedTaskRef = useRef(null)
  const sessionSavedRef = useRef(false)
  const defaultTitle    = useRef('Focus Board')

  // Hydrate on client only
  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    setSettings(getSettings())

    checkAndResetDay()

    const raw = localStorage.getItem('focusboard-tasks')
    if (raw) setTasks(JSON.parse(raw))

    const sess = localStorage.getItem('focusboard-session')
    if (sess) setSessionStart(Number(sess))

    const skip = localStorage.getItem('focusboard-skip-offset')
    if (skip) setSkipOffset(Number(skip))

    const p = localStorage.getItem('focusboard-paused-at')
    if (p) { setPaused(true); setPausedAt(Number(p)) }

    const mb = localStorage.getItem('focusboard-manual-break')
    if (mb) setManualBreak(true)

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

    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)

    return () => {
      clearInterval(tick)
      clearInterval(poll)
      document.removeEventListener('fullscreenchange', onFs)
      document.title = defaultTitle.current
    }
  }, [])

  // Compute current state
  const validTasks = tasks.filter(t => t.text?.trim())
  const breaksEnabled = settings?.breaksEnabled ?? false
  const breakDuration = (settings?.breakDuration ?? 5) * 60 // seconds

  // Use pausedAt as "now" when paused so timer freezes
  const effectiveNow = paused && pausedAt ? pausedAt : now

  let currentTask   = null
  let secondsLeft   = 0
  let nextTask      = null
  let isOnBreak     = false
  let allDone       = false
  let currentTaskIdx = -1
  let waitingToStart = false
  let waitSeconds    = 0

  if (sessionStart && validTasks.length > 0 && effectiveNow) {
    // Session start is in the future (planned start time)
    if (sessionStart > effectiveNow) {
      waitingToStart = true
      waitSeconds = Math.ceil((sessionStart - effectiveNow) / 1000)
    }

    let elapsed = Math.floor((effectiveNow - sessionStart) / 1000) + skipOffset
    let cursor  = 0

    for (let i = 0; i < validTasks.length; i++) {
      const task = validTasks[i]

      // Skip completed tasks but account for their duration in the timeline
      if (task.completed) {
        cursor += task.duration * 60
        if (breaksEnabled && nextNonCompleted(validTasks, i) !== null) {
          cursor += breakDuration
        }
        continue
      }

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
    if (!sessionStart || !effectiveNow || !validTasks.length || paused) return

    let elapsed = Math.floor((effectiveNow - sessionStart) / 1000) + skipOffset
    let cursor  = 0

    for (let i = 0; i < validTasks.length; i++) {
      const task = validTasks[i]
      if (task.completed) {
        cursor += task.duration * 60
        if (breaksEnabled) cursor += breakDuration
        continue
      }
      const dur = task.duration * 60
      if (elapsed >= cursor + dur) {
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
  }, [effectiveNow, sessionStart, skipOffset, paused])

  // Notification when task time runs out
  useEffect(() => {
    if (!currentTask || !settings) return

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
    if (waitingToStart) {
      document.title = `Starts in ${formatCountdown(waitSeconds)} | Focus Board`
    } else if (paused) {
      document.title = 'Paused | Focus Board'
    } else if (manualBreak) {
      document.title = 'Break | Focus Board'
    } else if (currentTask && secondsLeft > 0) {
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
  }, [secondsLeft, currentTask, isOnBreak, allDone, mounted, paused, manualBreak, waitingToStart, waitSeconds])

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

    const updated = tasks.map(t =>
      t.id === currentTask.id ? { ...t, completed: true } : t
    )
    setTasks(updated)
    localStorage.setItem('focusboard-tasks', JSON.stringify(updated))
    notifiedTaskRef.current = null
  }, [currentTask, skipOffset, secondsLeft, tasks])

  const handlePause = useCallback(() => {
    const pauseTime = Date.now()
    setPaused(true)
    setPausedAt(pauseTime)
    localStorage.setItem('focusboard-paused-at', String(pauseTime))
  }, [])

  const handleResume = useCallback(() => {
    if (!pausedAt) return
    // Shift session start forward by the paused duration so timer continues from where it stopped
    const pausedDuration = Date.now() - pausedAt
    const newStart = sessionStart + pausedDuration
    setSessionStart(newStart)
    localStorage.setItem('focusboard-session', String(newStart))
    setPaused(false)
    setPausedAt(null)
    localStorage.removeItem('focusboard-paused-at')
    setManualBreak(false)
    localStorage.removeItem('focusboard-manual-break')
  }, [pausedAt, sessionStart])

  const handleTakeBreak = useCallback(() => {
    setManualBreak(true)
    localStorage.setItem('focusboard-manual-break', '1')
    handlePause()
  }, [handlePause])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }, [])

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
          router.push('/manage')
        )}
        <SessionHistory />
      </div>
    )
  }

  // ── Waiting for planned start time ──────────────────────────────────
  if (waitingToStart) {
    const firstTask = validTasks.find(t => !t.completed)
    const startTime = new Date(sessionStart).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    return (
      <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none">
        <p className="text-[var(--text-dim)] text-sm uppercase tracking-[0.4em] mb-6">Your day starts at {startTime}</p>

        <p
          className="font-mono font-bold tabular-nums text-[var(--accent)]"
          style={{ fontSize: 'clamp(3rem, 10vw, 8rem)' }}
        >
          {formatCountdown(waitSeconds)}
        </p>

        {firstTask && (
          <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-10 max-w-[90vw] truncate text-center px-4">
            First up &rarr; {firstTask.text}
          </p>
        )}

        <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
        <Link
          href="/manage"
          className="absolute bottom-6 right-6 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm transition-colors"
        >
          manage
        </Link>
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

  // ── Manual break (paused by user) ─────────────────────────────────
  if (manualBreak && paused) {
    return (
      <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none">
        <p className="text-[var(--success)] text-sm uppercase tracking-[0.4em] mb-6">Break Time</p>

        <h1
          className="font-black uppercase text-[var(--success)] leading-none text-center px-6"
          style={{ fontSize: 'clamp(2.5rem, 9vw, 8rem)' }}
        >
          RELAX
        </h1>

        <p className="text-[var(--text-dim)] text-lg mt-8">Timer paused &mdash; resume when ready</p>

        {currentTask && (
          <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-6 max-w-[90vw] truncate text-center px-4">
            Up next &rarr; {currentTask.text}
          </p>
        )}

        <button
          onClick={handleResume}
          className="mt-8 bg-[var(--text)] text-[var(--bg)] font-bold px-8 py-3 rounded-full hover:opacity-90 transition-colors"
        >
          End Break
        </button>

        <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
        <Link
          href="/manage"
          className="absolute bottom-6 right-6 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm transition-colors"
        >
          manage
        </Link>
      </div>
    )
  }

  // ── Paused ────────────────────────────────────────────────────────
  if (paused && currentTask) {
    const taskDurSec = currentTask.duration * 60
    const progress   = ((taskDurSec - secondsLeft) / taskDurSec) * 100

    return (
      <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none">
        <div className="absolute top-0 left-0 h-1 bg-[var(--bg-hover)] w-full">
          <div className="h-full bg-[var(--accent)]" style={{ width: `${progress}%` }} />
        </div>

        <p className="text-[var(--accent)] text-sm uppercase tracking-[0.4em] mb-6">Paused</p>

        <h1
          className="font-black uppercase text-[var(--text)] leading-none text-center px-6 opacity-50"
          style={{ fontSize: taskFontSize(currentTask.text), wordBreak: 'break-word', maxWidth: '90vw' }}
        >
          {currentTask.text}
        </h1>

        <p
          className="font-mono font-bold mt-8 tabular-nums text-[var(--accent)] opacity-50"
          style={{ fontSize: 'clamp(2rem, 6vw, 4.5rem)' }}
        >
          {formatCountdown(secondsLeft)}
        </p>

        <button
          onClick={handleResume}
          className="mt-10 bg-[var(--text)] text-[var(--bg)] font-bold px-8 py-3 rounded-full hover:opacity-90 transition-colors"
        >
          Resume
        </button>

        <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
        <Link
          href="/manage"
          className="absolute bottom-6 right-6 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm transition-colors"
        >
          manage
        </Link>
      </div>
    )
  }

  // ── Auto break (between tasks) ────────────────────────────────────
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
          <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-10 max-w-[90vw] truncate text-center px-4">
            Next &rarr; {currentTask.text}
          </p>
        )}

        <button
          onClick={handleSkip}
          className="mt-8 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Skip break
        </button>

        <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
        <Link
          href="/manage"
          className="absolute bottom-6 right-6 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm transition-colors"
        >
          manage
        </Link>
      </div>
    )
  }

  // ── Null guard (currentTask could be null during initial render) ───
  if (!currentTask) return null

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
        style={{ fontSize: taskFontSize(currentTask.text), wordBreak: 'break-word', maxWidth: '90vw' }}
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

      {/* action buttons */}
      <div className="flex items-center justify-center gap-3 mt-10 flex-wrap px-4">
        <button
          onClick={handlePause}
          className="text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Pause
        </button>
        <button
          onClick={handleTakeBreak}
          className="text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Take a Break
        </button>
        <button
          onClick={handleSkip}
          className="text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Skip &rarr;
        </button>
      </div>

      {/* next task */}
      {nextTask && (
        <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-6 max-w-[90vw] truncate text-center px-4">
          Next &rarr; {nextTask.text}
        </p>
      )}

      {/* fullscreen + manage */}
      <FullscreenBtn isFullscreen={isFullscreen} onToggle={toggleFullscreen} />
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
