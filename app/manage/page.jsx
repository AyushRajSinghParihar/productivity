'use client'
import { useState, useEffect, useRef, useCallback } from 'react'
import Link from 'next/link'
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { getSettings, getEffectiveDate } from '../lib/settings'
import { checkAndResetDay, stampToday } from '../lib/dayReset'
import ConfirmDialog from '../components/ConfirmDialog'
import TimeInput from '../components/TimeInput'
import {
  advanceRuntime,
  applyRuntimeAction,
  createRuntimeState,
  deriveRuntimeView,
  finalizeHistorySession,
  getStoredRuntime,
  hasRuntimeProgress,
  isBreakItem,
  saveStoredRuntime,
} from '../lib/runtime.mjs'
import { computeStartTimes, msToTimeStr, timeStrToMinutes } from '../lib/schedule.mjs'
import { saveSession } from '../lib/history'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const blankTask = () => ({ id: uid(), text: '', duration: 25, completed: false, anchor: 'duration', endMin: null })
const blankBreak = () => ({ id: uid(), type: 'break', text: '', duration: 5, completed: false, anchor: 'duration', endMin: null })

const normalizeTask = (task) => ({
  ...task,
  anchor: task.anchor === 'end' ? 'end' : 'duration',
  endMin: Number.isFinite(task.endMin) ? task.endMin : null,
})

function runtimesDiffer(left, right) {
  return JSON.stringify(left) !== JSON.stringify(right)
}

function runtimeTasksToDisplay(runtime) {
  return [...runtime.tasks]
    .sort((left, right) => left.order - right.order)
    .map(task => ({
      id: task.id,
      type: task.type === 'break' ? 'break' : 'task',
      text: task.text,
      duration: Math.round(task.plannedDurationSeconds / 60),
      completed: task.status === 'completed' || task.status === 'skipped',
      runtimeStatus: task.status,
    }))
}

export default function ManagePage() {
  const [tasks, setTasks] = useState([blankTask()])
  const [runtime, setRuntime] = useState(null)
  const [plannedStart, setPlannedStart] = useState(null)
  const [plannedStartMode, setPlannedStartMode] = useState('auto')
  const [now, setNow] = useState(null)
  const [mounted, setMounted] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const inputRefs = useRef({})
  const archivedSessionIdsRef = useRef(new Set())

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  const persistRuntime = useCallback((nextRuntime) => {
    setRuntime(nextRuntime)
    if (typeof window !== 'undefined') saveStoredRuntime(localStorage, nextRuntime)
  }, [])

  useEffect(() => {
    setMounted(true)
    setNow(Date.now())
    checkAndResetDay()

    const rawTasks = localStorage.getItem('focusboard-tasks')
    if (rawTasks) {
      const parsed = JSON.parse(rawTasks).map(normalizeTask)
      setTasks(parsed.length ? parsed : [blankTask()])
    }

    const storedRuntime = getStoredRuntime(localStorage)
    if (storedRuntime) setRuntime(storedRuntime)

    setPlannedStartMode(localStorage.getItem('focusboard-planned-start-mode') === 'fixed' ? 'fixed' : 'auto')

    const storedPlannedStart = localStorage.getItem('focusboard-planned-start')
    if (storedPlannedStart) {
      setPlannedStart(storedPlannedStart)
    } else if (!storedRuntime) {
      const loaded = rawTasks ? JSON.parse(rawTasks) : [blankTask()]
      const { starts } = computeStartTimes(loaded, { plannedStartMode: 'auto' }, Date.now())
      const defaultStart = msToTimeStr(starts[0])
      setPlannedStart(defaultStart)
      localStorage.setItem('focusboard-planned-start', defaultStart)
    }

    const poll = setInterval(() => {
      const nextTasks = localStorage.getItem('focusboard-tasks')
      if (nextTasks) {
        const parsed = JSON.parse(nextTasks).map(normalizeTask)
        setTasks(parsed.length ? parsed : [blankTask()])
      } else {
        setTasks([blankTask()])
      }

      const nextRuntime = getStoredRuntime(localStorage)
      setRuntime(nextRuntime)

      if (!nextRuntime) {
        const nextPlannedStart = localStorage.getItem('focusboard-planned-start')
        setPlannedStart(nextPlannedStart || null)
        setPlannedStartMode(localStorage.getItem('focusboard-planned-start-mode') === 'fixed' ? 'fixed' : 'auto')
      }
    }, 2000)

    const tick = setInterval(() => setNow(Date.now()), 1000)

    return () => {
      clearInterval(poll)
      clearInterval(tick)
    }
  }, [])

  useEffect(() => {
    if (!runtime || !now) return
    const advanced = advanceRuntime(runtime, now)
    if (runtimesDiffer(runtime, advanced)) {
      persistRuntime(advanced)
    }
  }, [runtime, now, persistRuntime])

  const view = deriveRuntimeView(runtime, now ?? Date.now())
  const activeRuntime = view.runtime
  const sessionLocked = !!activeRuntime
  const settings = getSettings()

  useEffect(() => {
    if (!activeRuntime || activeRuntime.archivedAt || archivedSessionIdsRef.current.has(activeRuntime.id)) return
    if (!view.allDone) return

    const effectiveDate = getEffectiveDate(settings).toISOString().split('T')[0]
    const session = finalizeHistorySession(activeRuntime, {
      now: activeRuntime.actualEndAt ?? Date.now(),
      date: effectiveDate,
    })

    if (session) saveSession(session)
    archivedSessionIdsRef.current.add(activeRuntime.id)
    persistRuntime(applyRuntimeAction(activeRuntime, { type: 'mark_archived' }, Date.now()))
  }, [activeRuntime, view.allDone, settings, persistRuntime])

  useEffect(() => {
    const handler = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        startSession()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  })

  const persist = useCallback((next) => {
    setTasks(next)
    localStorage.setItem('focusboard-tasks', JSON.stringify(next))
    stampToday()
  }, [])

  const updateField = (id, field, value) => {
    if (sessionLocked) return
    persist(tasks.map(task => (task.id === id ? { ...task, [field]: value } : task)))
  }

  const updateFields = (id, patch) => {
    if (sessionLocked) return
    persist(tasks.map(task => (task.id === id ? { ...task, ...patch } : task)))
  }

  const toggleCompleted = (id) => {
    if (activeRuntime) {
      const displayTask = runtimeTasksToDisplay(activeRuntime).find(task => task.id === id)
      if (!displayTask || isBreakItem(displayTask) || displayTask.completed) return
      persistRuntime(applyRuntimeAction(activeRuntime, {
        type: 'toggle_task_from_planner',
        taskId: id,
        completed: true,
      }, Date.now()))
      return
    }

    if (isBreakItem(tasks.find(task => task.id === id))) return
    persist(tasks.map(task => (task.id === id ? { ...task, completed: !task.completed } : task)))
  }

  const handlePaste = (e, id) => {
    if (sessionLocked) return

    const text = e.clipboardData.getData('text')
    const lines = text.split('\n')
      .map(line => line.trim())
      .map(line => line.replace(/^[-*]\s*\[.\]\s*/, ''))
      .filter(Boolean)

    if (lines.length <= 1) return

    e.preventDefault()
    const idx = tasks.findIndex(task => task.id === id)
    const newRows = lines.map(line => ({ id: uid(), text: line, duration: 25, completed: false, anchor: 'duration', endMin: null }))
    const next = [...tasks]
    next.splice(idx, 1, ...newRows)
    persist(next)

    setTimeout(() => {
      const lastId = newRows[newRows.length - 1].id
      inputRefs.current[lastId]?.focus()
    }, 50)
  }

  const handleKeyDown = (e, id, idx) => {
    if (sessionLocked) return

    if (e.key === 'Enter') {
      e.preventDefault()
      const fresh = blankTask()
      const next = [...tasks]
      next.splice(idx + 1, 0, fresh)
      persist(next)
      setTimeout(() => inputRefs.current[fresh.id]?.focus(), 50)
    }

    if (e.key === 'Backspace' && tasks[idx].text === '' && tasks.length > 1) {
      e.preventDefault()
      const next = tasks.filter(task => task.id !== id)
      persist(next)
      setTimeout(() => {
        const prevId = next[Math.max(0, idx - 1)]?.id
        if (prevId) inputRefs.current[prevId]?.focus()
      }, 50)
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      const nextId = tasks[idx + 1]?.id
      if (nextId) inputRefs.current[nextId]?.focus()
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      const prevId = tasks[idx - 1]?.id
      if (prevId) inputRefs.current[prevId]?.focus()
    }
  }

  const handleDragEnd = (event) => {
    if (sessionLocked) return

    const { active, over } = event
    if (active.id !== over?.id) {
      const oldIndex = tasks.findIndex(task => task.id === active.id)
      const newIndex = tasks.findIndex(task => task.id === over.id)
      persist(arrayMove(tasks, oldIndex, newIndex))
    }
  }

  const deleteTask = (id) => {
    if (sessionLocked) return

    const next = tasks.filter(task => task.id !== id)
    persist(next.length ? next : [blankTask()])
  }

  const startSession = () => {
    // A session needs at least one real task; break-only lists can't start.
    const realTasks = tasks.filter(task => !isBreakItem(task) && task.text.trim())
    if (!realTasks.length) return

    // Carry breaks into the runtime even though they have no text.
    const itemsToRun = tasks.filter(task => isBreakItem(task) || task.text.trim())
    const reset = itemsToRun.map(task => ({ ...task, completed: false }))
    persist(reset)

    let plannedStartAt = null
    if (plannedStartMode === 'fixed') {
      const effectivePlannedStart = plannedStart || localStorage.getItem('focusboard-planned-start')
      if (effectivePlannedStart) {
        const [h, m] = effectivePlannedStart.split(':').map(Number)
        const planned = new Date()
        planned.setHours(h, m, 0, 0)
        plannedStartAt = planned.getTime()
      }
    }

    const nextRuntime = createRuntimeState({
      tasks: reset,
      plannedStartAt,
      now: Date.now(),
      settings,
    })

    persistRuntime(nextRuntime)
  }

  const resetSession = () => {
    if (activeRuntime && !activeRuntime.archivedAt && hasRuntimeProgress(activeRuntime)) {
      const effectiveDate = getEffectiveDate(settings).toISOString().split('T')[0]
      const session = finalizeHistorySession(activeRuntime, { now: Date.now(), date: effectiveDate })
      if (session) saveSession(session)
    }

    persistRuntime(null)
    localStorage.removeItem('focusboard-planned-start')
    localStorage.removeItem('focusboard-planned-start-mode')
    setPlannedStart(null)
    setPlannedStartMode('auto')
    setConfirmReset(false)
  }

  if (!mounted) return null

  const effectDate = getEffectiveDate(settings)
  const today = effectDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const displayTasks = activeRuntime ? runtimeTasksToDisplay(activeRuntime) : tasks
  const validTasks = displayTasks.filter(task => !isBreakItem(task) && task.text.trim())
  const breakMin = displayTasks
    .filter(isBreakItem)
    .reduce((sum, task) => sum + Number(task.duration), 0)
  const { starts: taskStartTimes, ends: taskEndTimes, overdue: taskOverdue } = computeStartTimes(
    displayTasks,
    activeRuntime
      ? {
          sessionStartAt: activeRuntime.plannedStartAt,
          breaksEnabled: activeRuntime.breakSettings.enabled,
          breakDurationMinutes: activeRuntime.breakSettings.durationSeconds / 60,
        }
      : {
          plannedStart,
          plannedStartMode,
          breaksEnabled: settings.breaksEnabled,
          breakDurationMinutes: settings.breakDuration,
        },
    now ?? Date.now(),
  )
  const totalMin = displayTasks.reduce((sum, task, idx) => (
    !isBreakItem(task) && task.text.trim() ? sum + Math.round((taskEndTimes[idx] - taskStartTimes[idx]) / 60000) : sum
  ), 0)
  const totalHrs = (totalMin / 60).toFixed(1)

  let summaryLine = null
  if (activeRuntime) {
    if (view.waitingToStart) {
      summaryLine = `Session starts at ${msToTimeStr(activeRuntime.plannedStartAt)}`
    } else if (view.paused || view.manualBreak) {
      summaryLine = 'Session paused — wrap-up updates when you resume'
    } else if (view.predictedEndAt) {
      summaryLine = `${view.allDone ? 'Session finished' : 'Session active'} \u00b7 wraps up ~${new Date(view.predictedEndAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    }
  } else if (validTasks.length > 0) {
    // Last item that actually runs — a real task or a trailing break (which runs
    // as a wind-down) — so the wrap-up time includes it.
    const lastTaskIdx = displayTasks.findLastIndex(task => isBreakItem(task) || task.text.trim())
    const endTime = lastTaskIdx >= 0 ? taskEndTimes[lastTaskIdx] : null
    summaryLine = endTime
      ? `Starts at ${msToTimeStr(taskStartTimes[0])} \u00b7 wraps up ~${new Date(endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
      : null
  }

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-start justify-center">
      <div className="max-w-4xl w-full mx-auto px-4 sm:px-8 lg:px-10 pt-[12vh] pb-20">
        <div className="flex items-center justify-between mb-1">
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest">{today}</p>
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm transition-colors">
            &rarr; dashboard
          </Link>
        </div>
        <h1 className="text-5xl font-bold mb-3">Today&apos;s Focus</h1>
        <p className="text-[var(--text-dim)] text-base mb-3">
          Paste a list from Notion to auto-import all tasks at once.
        </p>
        {sessionLocked && (
          <p className="text-[var(--text-muted)] text-sm mb-9">
            Active sessions are frozen snapshots. Reset or restart to edit task order, durations, or break timing.
          </p>
        )}
        {!sessionLocked && <div className="mb-12" />}

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={displayTasks.map(task => task.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {displayTasks.map((task, idx) => (
                <SortableTask
                  key={task.id}
                  task={task}
                  idx={idx}
                  isFirst={idx === 0}
                  startMs={taskStartTimes[idx]}
                  endMs={taskEndTimes[idx]}
                  overdue={taskOverdue[idx]}
                  sessionLocked={sessionLocked}
                  onPlannedStartChange={(value) => {
                    if (sessionLocked) return
                    setPlannedStart(value)
                    setPlannedStartMode('fixed')
                    localStorage.setItem('focusboard-planned-start', value)
                    localStorage.setItem('focusboard-planned-start-mode', 'fixed')
                  }}
                  inputRefs={inputRefs}
                  updateField={updateField}
                  updateFields={updateFields}
                  toggleCompleted={toggleCompleted}
                  handlePaste={handlePaste}
                  handleKeyDown={handleKeyDown}
                  deleteTask={deleteTask}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <div className="mt-4 flex items-center gap-5">
          <button
            onClick={() => {
              if (sessionLocked) return
              const fresh = blankTask()
              persist([...tasks, fresh])
              setTimeout(() => inputRefs.current[fresh.id]?.focus(), 50)
            }}
            disabled={sessionLocked}
            className="text-[var(--text-dim)] hover:text-[var(--text-muted)] disabled:opacity-40 disabled:cursor-not-allowed text-base flex items-center gap-2 transition-colors px-2"
          >
            <span className="text-lg leading-none">+</span> add task
          </button>
          <button
            onClick={() => {
              if (sessionLocked) return
              const fresh = blankBreak()
              persist([...tasks, fresh])
              setTimeout(() => inputRefs.current[fresh.id]?.focus(), 50)
            }}
            disabled={sessionLocked}
            className="text-[var(--text-dim)] hover:text-[var(--success)] disabled:opacity-40 disabled:cursor-not-allowed text-base flex items-center gap-2 transition-colors px-2"
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
              <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
              <line x1="6" y1="1" x2="6" y2="4" />
              <line x1="10" y1="1" x2="10" y2="4" />
              <line x1="14" y1="1" x2="14" y2="4" />
            </svg>
            add break
          </button>
        </div>

        <div className="mt-10 pt-5 border-t border-[var(--border)] flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="text-[var(--text-muted)] text-sm space-y-0.5">
            <p>
              {validTasks.length} task{validTasks.length !== 1 ? 's' : ''} &middot; {totalMin} min ({totalHrs}h)
              {breakMin > 0 ? ` · ${breakMin} min break` : ''}
            </p>
            {summaryLine && (
              <p className="text-[var(--text-dim)] text-xs">{summaryLine}</p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-3">
              {sessionLocked && (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm px-7 py-2.5 rounded-full border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors"
                >
                  Reset
                </button>
              )}
              <button
                onClick={startSession}
                disabled={tasks.filter(task => !isBreakItem(task) && task.text.trim()).length === 0}
                className="bg-[var(--text)] text-[var(--bg)] font-bold px-7 py-2.5 rounded-full hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {sessionLocked ? 'Restart' : 'Start Session'}
              </button>
            </div>
            <span className="text-[var(--text-dim)] text-xs">
              {navigator?.platform?.includes('Mac') ? '\u2318' : 'Ctrl'}+Enter
            </span>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmReset}
        message="Reset this session? Any progress will be saved to history."
        onConfirm={resetSession}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  )
}

function SortableTask({
  task,
  idx,
  isFirst,
  startMs,
  endMs,
  overdue,
  sessionLocked,
  onPlannedStartChange,
  inputRefs,
  updateField,
  updateFields,
  toggleCompleted,
  handlePaste,
  handleKeyDown,
  deleteTask,
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id, disabled: sessionLocked })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const isBreak = isBreakItem(task)
  const startStr = msToTimeStr(startMs)
  const endStr = msToTimeStr(endMs)
  const durationMin = Math.max(1, Math.round((endMs - startMs) / 60000))

  const handleEndChange = (newEndStr) => {
    if (isBreak) {
      // Breaks stay duration-only: editing the end just resizes the break.
      let diff = timeStrToMinutes(newEndStr) - timeStrToMinutes(startStr)
      if (diff <= 0) diff += 24 * 60
      updateFields(task.id, { anchor: 'duration', endMin: null, duration: Math.max(1, Math.min(480, diff)) })
      return
    }
    updateFields(task.id, { anchor: 'end', endMin: timeStrToMinutes(newEndStr) })
  }

  const runtimeLabel = task.runtimeStatus === 'skipped'
    ? 'Skipped'
    : task.runtimeStatus === 'completed'
      ? 'Done'
      : task.runtimeStatus === 'active'
        ? 'Active'
        : null

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex items-center gap-3 group rounded-lg px-2 py-1 hover:bg-[var(--bg-hover)] transition-colors ${
        isBreak ? 'border-l-2 border-[var(--success)] pl-2.5' : ''
      }`}
    >
      <button
        {...attributes}
        {...listeners}
        className="text-[var(--text-dim)] hover:text-[var(--text-muted)] cursor-grab active:cursor-grabbing shrink-0 touch-none disabled:opacity-30"
        tabIndex={-1}
        disabled={sessionLocked}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="9" cy="6" r="1.5" />
          <circle cx="15" cy="6" r="1.5" />
          <circle cx="9" cy="12" r="1.5" />
          <circle cx="15" cy="12" r="1.5" />
          <circle cx="9" cy="18" r="1.5" />
          <circle cx="15" cy="18" r="1.5" />
        </svg>
      </button>

      {isBreak ? (
        <span
          className="w-5 h-5 shrink-0 flex items-center justify-center text-[var(--success)]"
          title="Break"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8h1a4 4 0 0 1 0 8h-1" />
            <path d="M2 8h16v9a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4V8z" />
            <line x1="6" y1="1" x2="6" y2="4" />
            <line x1="10" y1="1" x2="10" y2="4" />
            <line x1="14" y1="1" x2="14" y2="4" />
          </svg>
        </span>
      ) : (
        <button
          onClick={() => toggleCompleted(task.id)}
          className={`w-5 h-5 rounded border shrink-0 flex items-center justify-center transition-colors ${
            task.completed
              ? 'bg-[var(--success)] border-[var(--success)] text-white'
              : 'border-[var(--border)] hover:border-[var(--text-muted)]'
          }`}
        >
          {task.completed && (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          )}
        </button>
      )}

      <div className="flex-1 min-w-0">
        <input
          ref={el => { inputRefs.current[task.id] = el }}
          value={task.text}
          onChange={e => updateField(task.id, 'text', e.target.value)}
          onPaste={e => handlePaste(e, task.id)}
          onKeyDown={e => handleKeyDown(e, task.id, idx)}
          disabled={sessionLocked}
          placeholder={isBreak ? 'Break' : 'What are you working on?'}
          className={`w-full bg-transparent outline-none py-2.5 text-xl placeholder:text-[var(--text-dim)] caret-[var(--text)] disabled:opacity-70 ${
            isBreak ? 'text-[var(--success)] font-medium' : 'text-[var(--text)]'
          } ${task.completed && !isBreak ? 'line-through opacity-50' : ''}`}
        />
        {runtimeLabel && (
          <p className="text-[var(--text-dim)] text-[11px] uppercase tracking-widest -mt-1 mb-1">
            {runtimeLabel}
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 sm:opacity-0 sm:group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
        {isFirst && !sessionLocked ? (
          <TimeInput
            value={startStr}
            onChange={onPlannedStartChange}
            className="w-16 bg-[var(--bg-hover)] border border-[var(--border)] rounded px-1.5 py-1 text-xs text-center outline-none focus:border-[var(--text-muted)] text-[var(--text)]"
          />
        ) : (
          <span className="hidden sm:inline text-[var(--text-muted)] text-xs tabular-nums">{startStr}</span>
        )}
        <span className="hidden sm:inline text-[var(--text-dim)] text-xs">&rarr;</span>
        {sessionLocked ? (
          <span className={`hidden sm:inline text-xs tabular-nums ${overdue ? 'text-[var(--danger)]' : 'text-[var(--text-muted)]'}`}>{endStr}</span>
        ) : (
          <span className="hidden sm:contents" title={overdue ? "Can't finish by this time" : undefined}>
            <TimeInput
              value={endStr}
              onChange={handleEndChange}
              className={`w-16 bg-[var(--bg-hover)] border rounded px-1.5 py-1 text-xs text-center outline-none focus:border-[var(--text-muted)] text-[var(--text)] ${overdue ? 'border-[var(--danger)] text-[var(--danger)]' : 'border-[var(--border)]'}`}
            />
          </span>
        )}

        <input
          type="number"
          value={durationMin}
          onChange={e => updateFields(task.id, { anchor: 'duration', endMin: null, duration: Math.max(1, Number(e.target.value)) })}
          disabled={sessionLocked}
          className="w-12 bg-[var(--bg-hover)] border border-[var(--border)] rounded px-2 py-1 text-xs text-center outline-none focus:border-[var(--text-muted)] text-[var(--text)] disabled:opacity-50"
          min="1"
          max="480"
        />
        <span className="text-[var(--text-dim)] text-xs">min</span>

        <button
          onClick={() => deleteTask(task.id)}
          disabled={sessionLocked}
          className="text-[var(--text-dim)] hover:text-[var(--danger)] transition-colors text-lg leading-none disabled:opacity-30 disabled:cursor-not-allowed"
        >
          &times;
        </button>
      </div>
    </div>
  )
}
