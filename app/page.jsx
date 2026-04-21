'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { getSettings, getEffectiveDate } from './lib/settings'
import { playNotificationSound } from './lib/audio'
import { saveSession } from './lib/history'
import { checkAndResetDay } from './lib/dayReset'
import SessionHistory from './components/SessionHistory'
import {
  advanceRuntime,
  applyRuntimeAction,
  deriveRuntimeView,
  finalizeHistorySession,
  getStoredRuntime,
  saveStoredRuntime,
} from './lib/runtime.mjs'

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
  if (typeof document !== 'undefined' && !document.documentElement.requestFullscreen) return null

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

function runtimesDiffer(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right)
}

export default function Dashboard() {
  const [tasks, setTasks] = useState([])
  const [runtime, setRuntime] = useState(null)
  const [now, setNow] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [flashing, setFlashing] = useState(false)
  const [settings, setSettings] = useState(null)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const router = useRouter()
  const defaultTitle = useRef('Focus Board')
  const archivedSessionIdsRef = useRef(new Set())
  const notifiedTaskIdsRef = useRef(new Set())
  const trackedRuntimeIdRef = useRef(null)

  const persistRuntime = useCallback((nextRuntime) => {
    setRuntime(nextRuntime)
    if (typeof window !== 'undefined') {
      saveStoredRuntime(localStorage, nextRuntime)
    }
  }, [])

  useEffect(() => {
    setMounted(true)
    const currentNow = Date.now()
    setNow(currentNow)
    setSettings(getSettings())

    checkAndResetDay()

    const rawTasks = localStorage.getItem('focusboard-tasks')
    if (rawTasks) setTasks(JSON.parse(rawTasks))

    const storedRuntime = getStoredRuntime(localStorage)
    if (storedRuntime) setRuntime(storedRuntime)

    const poll = setInterval(() => {
      const nextTasks = localStorage.getItem('focusboard-tasks')
      if (nextTasks) {
        setTasks(JSON.parse(nextTasks))
      } else {
        setTasks([])
      }
      setSettings(getSettings())
      setRuntime(getStoredRuntime(localStorage))
    }, 2000)

    const tick = setInterval(() => setNow(Date.now()), 1000)

    const onFs = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)

    return () => {
      clearInterval(poll)
      clearInterval(tick)
      document.removeEventListener('fullscreenchange', onFs)
      document.title = defaultTitle.current
    }
  }, [])

  useEffect(() => {
    if (!runtime || !now) return
    const advanced = advanceRuntime(runtime, now)
    if (runtimesDiffer(runtime, advanced)) {
      persistRuntime(advanced)
    }
  }, [runtime, now, persistRuntime])

  const validTasks = tasks.filter(task => task.text?.trim())
  const view = deriveRuntimeView(runtime, now ?? Date.now())
  const activeRuntime = view.runtime
  const currentTask = view.currentTask
  const nextTask = view.nextTask
  const secondsLeft = view.secondsLeft
  const waitingToStart = view.waitingToStart
  const paused = view.paused
  const manualBreak = view.manualBreak
  const isOnBreak = view.isOnBreak
  const allDone = view.allDone

  useEffect(() => {
    if (!mounted || runtime || validTasks.length > 0) return
    router.push('/manage')
  }, [mounted, runtime, validTasks.length, router])

  useEffect(() => {
    if (!activeRuntime?.id || trackedRuntimeIdRef.current === activeRuntime.id) return
    trackedRuntimeIdRef.current = activeRuntime.id
    archivedSessionIdsRef.current.delete(activeRuntime.id)
    const existingNaturalCompletions = activeRuntime.tasks
      .filter(task => task.status === 'completed' && task.actualFocusSeconds >= task.plannedDurationSeconds)
      .map(task => task.id)
    notifiedTaskIdsRef.current = new Set(existingNaturalCompletions)
  }, [activeRuntime])

  useEffect(() => {
    if (!activeRuntime || !settings) return
    const naturallyCompleted = activeRuntime.tasks.filter(
      task => task.status === 'completed' && task.actualFocusSeconds >= task.plannedDurationSeconds
    )
    const newIds = naturallyCompleted
      .map(task => task.id)
      .filter(id => !notifiedTaskIdsRef.current.has(id))

    if (newIds.length > 0) {
      if (settings.notificationSound) playNotificationSound()
      if (settings.notificationFlash) {
        setFlashing(true)
        setTimeout(() => setFlashing(false), 1600)
      }
    }

    notifiedTaskIdsRef.current = new Set(naturallyCompleted.map(task => task.id))
  }, [activeRuntime, settings])

  useEffect(() => {
    if (!activeRuntime || !allDone || !settings) return
    if (activeRuntime.archivedAt || archivedSessionIdsRef.current.has(activeRuntime.id)) return

    const effectiveDate = getEffectiveDate(settings).toISOString().split('T')[0]
    const session = finalizeHistorySession(activeRuntime, {
      now: activeRuntime.actualEndAt ?? Date.now(),
      date: effectiveDate,
    })

    if (session) saveSession(session)
    archivedSessionIdsRef.current.add(activeRuntime.id)
    persistRuntime(applyRuntimeAction(activeRuntime, { type: 'mark_archived' }, Date.now()))
  }, [activeRuntime, allDone, settings, persistRuntime])

  useEffect(() => {
    if (!mounted) return

    if (waitingToStart) {
      document.title = `Starts in ${formatCountdown(secondsLeft)} | Focus Board`
      return
    }

    if (paused) {
      document.title = 'Paused | Focus Board'
      return
    }

    if (manualBreak) {
      document.title = 'Break | Focus Board'
      return
    }

    if (isOnBreak) {
      document.title = `Break ${formatCountdown(secondsLeft)} | Focus Board`
      return
    }

    if (currentTask && secondsLeft > 0) {
      document.title = `${formatCountdown(secondsLeft)} \u2014 ${currentTask.text} | Focus Board`
      return
    }

    if (allDone) {
      document.title = 'All Done! | Focus Board'
      return
    }

    document.title = defaultTitle.current
  }, [mounted, waitingToStart, secondsLeft, paused, manualBreak, isOnBreak, currentTask, allDone])

  const handleRuntimeAction = useCallback((action) => {
    if (!runtime) return
    const nextRuntime = applyRuntimeAction(runtime, action, Date.now())
    persistRuntime(nextRuntime)
  }, [runtime, persistRuntime])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen()
    } else {
      document.documentElement.requestFullscreen()
    }
  }, [])

  if (!mounted) return null

  if (!runtime) {
    const hasTasks = validTasks.length > 0
    const totalMin = validTasks.reduce((sum, task) => sum + Number(task.duration), 0)

    if (!hasTasks) return null

    return (
      <div className={`min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center gap-6 ${flashing ? 'flash-notification' : ''}`}>
        <p className="text-[var(--text-dim)] text-2xl uppercase tracking-widest">Ready to focus</p>
        <div className="max-w-md w-full px-6 space-y-2 mb-4">
          {validTasks.map((task, index) => (
            <div key={task.id} className="flex items-center gap-3 text-[var(--text-muted)]">
              <span className="text-[var(--text-dim)] w-5 text-right text-xs">{index + 1}</span>
              <span className="flex-1 text-sm">{task.text}</span>
              <span className="text-[var(--text-dim)] text-xs">{task.duration}m</span>
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
        <SessionHistory />
      </div>
    )
  }

  if (waitingToStart) {
    const startTime = new Date(activeRuntime.plannedStartAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

    return (
      <div className="min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none">
        <p className="text-[var(--text-dim)] text-sm uppercase tracking-[0.4em] mb-6">Your day starts at {startTime}</p>

        <p
          className="font-mono font-bold tabular-nums text-[var(--accent)]"
          style={{ fontSize: 'clamp(3rem, 10vw, 8rem)' }}
        >
          {formatCountdown(secondsLeft)}
        </p>

        {currentTask && (
          <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-10 max-w-[90vw] truncate text-center px-4">
            First up &rarr; {currentTask.text}
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

  if (manualBreak && currentTask) {
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

        <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-6 max-w-[90vw] truncate text-center px-4">
          Up next &rarr; {currentTask.text}
        </p>

        <button
          onClick={() => handleRuntimeAction({ type: 'resume' })}
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

  if (paused && currentTask) {
    const taskDurSec = currentTask.plannedDurationSeconds
    const progress = ((taskDurSec - secondsLeft) / taskDurSec) * 100

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
          onClick={() => handleRuntimeAction({ type: 'resume' })}
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

  if (isOnBreak && currentTask) {
    const breakDuration = activeRuntime.breakSettings.durationSeconds
    const progress = ((breakDuration - secondsLeft) / breakDuration) * 100

    return (
      <div className={`min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none ${flashing ? 'flash-notification' : ''}`}>
        <div className="absolute top-0 left-0 h-1 bg-[var(--bg-hover)] w-full">
          <div
            className="h-full transition-all duration-1000 bg-[var(--success)]"
            style={{ width: `${progress}%` }}
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

        <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-10 max-w-[90vw] truncate text-center px-4">
          Next &rarr; {currentTask.text}
        </p>

        <button
          onClick={() => handleRuntimeAction({ type: 'skip_break' })}
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

  if (!currentTask) return null

  const urgency = secondsLeft < 120
  const taskDurSec = currentTask.plannedDurationSeconds
  const progress = ((taskDurSec - secondsLeft) / taskDurSec) * 100

  return (
    <div className={`min-h-screen bg-[var(--bg)] flex flex-col items-center justify-center relative overflow-hidden select-none ${flashing ? 'flash-notification' : ''}`}>
      <div className="absolute top-0 left-0 h-1 bg-[var(--bg-hover)] w-full">
        <div
          className={`h-full transition-all duration-1000 ${urgency ? 'bg-[var(--danger)]' : 'bg-[var(--text)]'}`}
          style={{ width: `${progress}%` }}
        />
      </div>

      <p className="text-[var(--text-dim)] text-sm uppercase tracking-[0.4em] mb-6">Right now</p>

      <h1
        className={`font-black uppercase leading-none text-center px-6 ${urgency ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}
        style={{ fontSize: taskFontSize(currentTask.text), wordBreak: 'break-word', maxWidth: '90vw' }}
      >
        {currentTask.text}
      </h1>

      <p
        className={`font-mono font-bold mt-8 tabular-nums ${urgency ? 'text-[var(--danger)]' : 'text-[var(--accent)]'}`}
        style={{ fontSize: 'clamp(2rem, 6vw, 4.5rem)' }}
      >
        {formatCountdown(secondsLeft)}
      </p>

      <div className="flex items-center justify-center gap-3 mt-10 flex-wrap px-4">
        <button
          onClick={() => handleRuntimeAction({ type: 'pause' })}
          className="text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Pause
        </button>
        <button
          onClick={() => handleRuntimeAction({ type: 'start_manual_break' })}
          className="text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Take a Break
        </button>
        <button
          onClick={() => handleRuntimeAction({ type: 'skip_task' })}
          className="text-[var(--text-dim)] hover:text-[var(--text-muted)] text-sm border border-[var(--border)] hover:border-[var(--border-hover)] px-6 py-2 rounded-full transition-colors"
        >
          Skip &rarr;
        </button>
      </div>

      {nextTask && (
        <p className="text-[var(--text-dim)] text-base sm:text-lg uppercase tracking-widest mt-6 max-w-[90vw] truncate text-center px-4">
          Next &rarr; {nextTask.text}
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
