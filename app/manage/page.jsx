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
import { saveSession } from '../lib/history'
import ConfirmDialog from '../components/ConfirmDialog'
import TimeInput from '../components/TimeInput'

const uid = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`
const blankTask = () => ({ id: uid(), text: '', duration: 25, completed: false })

function computeStartTimes(tasks, sessionStart, plannedStart) {
  let base
  if (sessionStart) {
    base = sessionStart
  } else if (plannedStart) {
    // Convert HH:MM string to today's date at that time
    const [h, m] = plannedStart.split(':').map(Number)
    const d = new Date()
    d.setHours(h, m, 0, 0)
    base = d.getTime()
  } else {
    const now = Date.now()
    const remainder = (5 - ((Math.floor(now / 60000)) % 5)) % 5
    base = now + remainder * 60000
  }

  const starts = []
  let cursor = base
  for (const task of tasks) {
    starts.push(cursor)
    cursor += task.duration * 60 * 1000
  }
  return starts
}

function msToTimeStr(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

function timeStrToMinutes(str) {
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

export default function ManagePage() {
  const [tasks, setTasks]               = useState([blankTask()])
  const [sessionStart, setSessionStart] = useState(null)
  const [plannedStart, setPlannedStart] = useState(null)
  const [mounted, setMounted]           = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)
  const inputRefs = useRef({})

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  )

  useEffect(() => {
    setMounted(true)
    const raw  = localStorage.getItem('focusboard-tasks')
    const sess = localStorage.getItem('focusboard-session')
    if (raw) {
      const parsed = JSON.parse(raw)
      setTasks(parsed.length ? parsed : [blankTask()])
    }
    if (sess) setSessionStart(Number(sess))
    const ps = localStorage.getItem('focusboard-planned-start')
    if (ps) setPlannedStart(ps)
  }, [])

  // Cmd/Ctrl+Enter to start session
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
  }, [])

  const updateField = (id, field, value) =>
    persist(tasks.map(t => t.id === id ? { ...t, [field]: value } : t))

  const toggleCompleted = (id) =>
    persist(tasks.map(t => t.id === id ? { ...t, completed: !t.completed } : t))

  const handlePaste = (e, id) => {
    const text  = e.clipboardData.getData('text')
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
    if (lines.length <= 1) return

    e.preventDefault()
    const idx     = tasks.findIndex(t => t.id === id)
    const newRows = lines.map(line => ({ id: uid(), text: line, duration: 25, completed: false }))
    const next    = [...tasks]
    next.splice(idx, 1, ...newRows)
    persist(next)

    setTimeout(() => {
      const lastId = newRows[newRows.length - 1].id
      inputRefs.current[lastId]?.focus()
    }, 50)
  }

  const handleKeyDown = (e, id, idx) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const fresh = blankTask()
      const next  = [...tasks]
      next.splice(idx + 1, 0, fresh)
      persist(next)
      setTimeout(() => inputRefs.current[fresh.id]?.focus(), 50)
    }
    if (e.key === 'Backspace' && tasks[idx].text === '' && tasks.length > 1) {
      e.preventDefault()
      const next = tasks.filter(t => t.id !== id)
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
    const { active, over } = event
    if (active.id !== over?.id) {
      const oldIndex = tasks.findIndex(t => t.id === active.id)
      const newIndex = tasks.findIndex(t => t.id === over.id)
      persist(arrayMove(tasks, oldIndex, newIndex))
    }
  }

  const deleteTask = (id) => {
    const next = tasks.filter(t => t.id !== id)
    persist(next.length ? next : [blankTask()])
  }

  const startSession = () => {
    const valid = tasks.filter(t => t.text.trim())
    if (!valid.length) return
    // Reset completed status and skip offset when starting fresh
    const reset = valid.map(t => ({ ...t, completed: false }))
    persist(reset)
    const ts = Date.now()
    localStorage.setItem('focusboard-session', String(ts))
    localStorage.setItem('focusboard-skip-offset', '0')
    setSessionStart(ts)
  }

  const resetSession = () => {
    // Save partial session to history before resetting
    if (sessionStart) {
      const settings = getSettings()
      const effectiveDate = getEffectiveDate(settings)
      const validTasks = tasks.filter(t => t.text?.trim())
      const completedTasks = validTasks.filter(t => t.completed)
      if (completedTasks.length > 0) {
        saveSession({
          id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
          date: effectiveDate.toISOString().split('T')[0],
          startTime: sessionStart,
          endTime: Date.now(),
          tasks: validTasks.map(t => ({
            text: t.text,
            duration: t.duration,
            completed: !!t.completed,
            skipped: false,
          })),
          totalTasks: validTasks.length,
          completedTasks: completedTasks.length,
          totalMinutes: validTasks.reduce((s, t) => s + t.duration, 0),
        })
      }
    }
    localStorage.removeItem('focusboard-session')
    localStorage.removeItem('focusboard-skip-offset')
    setSessionStart(null)
    setConfirmReset(false)
  }

  if (!mounted) return null

  const settings    = getSettings()
  const effectDate  = getEffectiveDate(settings)
  const today       = effectDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
  const validTasks  = tasks.filter(t => t.text.trim())
  const totalMin    = validTasks.reduce((s, t) => s + Number(t.duration), 0)
  const totalHrs    = (totalMin / 60).toFixed(1)
  const endTime     = sessionStart
    ? new Date(sessionStart + totalMin * 60 * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : null
  const taskStartTimes = computeStartTimes(tasks, sessionStart, plannedStart)

  return (
    <div className="min-h-screen bg-[var(--bg)] text-[var(--text)] flex items-start justify-center">
      <div className="max-w-4xl w-full mx-auto px-4 sm:px-8 lg:px-10 pt-[12vh] pb-20">

        {/* Header */}
        <div className="flex items-center justify-between mb-1">
          <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest">{today}</p>
          <Link href="/" className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm transition-colors">
            &rarr; dashboard
          </Link>
        </div>
        <h1 className="text-5xl font-bold mb-3">Today&apos;s Focus</h1>
        <p className="text-[var(--text-dim)] text-base mb-12">
          Paste a list from Notion to auto-import all tasks at once.
        </p>

        {/* Task list */}
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={tasks.map(t => t.id)} strategy={verticalListSortingStrategy}>
            <div className="space-y-1">
              {tasks.map((task, idx) => (
                <SortableTask
                  key={task.id}
                  task={task}
                  idx={idx}
                  isFirst={idx === 0}
                  isLast={idx === tasks.length - 1}
                  startMs={taskStartTimes[idx]}
                  sessionActive={!!sessionStart}
                  onPlannedStartChange={(val) => {
                    setPlannedStart(val)
                    localStorage.setItem('focusboard-planned-start', val)
                  }}
                  inputRefs={inputRefs}
                  updateField={updateField}
                  toggleCompleted={toggleCompleted}
                  handlePaste={handlePaste}
                  handleKeyDown={handleKeyDown}
                  deleteTask={deleteTask}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Add row */}
        <button
          onClick={() => {
            const fresh = blankTask()
            persist([...tasks, fresh])
            setTimeout(() => inputRefs.current[fresh.id]?.focus(), 50)
          }}
          className="mt-4 text-[var(--text-dim)] hover:text-[var(--text-muted)] text-base flex items-center gap-2 transition-colors px-2"
        >
          <span className="text-lg leading-none">+</span> add task
        </button>

        {/* Divider + summary */}
        <div className="mt-10 pt-5 border-t border-[var(--border)] flex items-center justify-between">
          <div className="text-[var(--text-muted)] text-sm space-y-0.5">
            <p>{validTasks.length} task{validTasks.length !== 1 ? 's' : ''} &middot; {totalMin} min ({totalHrs}h)</p>
            {sessionStart && (
              <p className="text-[var(--text-dim)] text-xs">
                Session started &middot; wraps up ~{endTime}
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-3">
              {sessionStart && (
                <button
                  onClick={() => setConfirmReset(true)}
                  className="text-[var(--text-muted)] hover:text-[var(--text)] text-sm px-7 py-2.5 rounded-full border border-[var(--border)] hover:border-[var(--border-hover)] transition-colors"
                >
                  Reset
                </button>
              )}
              <button
                onClick={startSession}
                disabled={validTasks.length === 0}
                className="bg-[var(--text)] text-[var(--bg)] font-bold px-7 py-2.5 rounded-full hover:opacity-90 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                {sessionStart ? 'Restart' : 'Start Session'}
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

function SortableTask({ task, idx, isFirst, isLast, startMs, sessionActive, onPlannedStartChange, inputRefs, updateField, toggleCompleted, handlePaste, handleKeyDown, deleteTask }) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: task.id })

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  }

  const startStr = msToTimeStr(startMs)
  const endStr   = msToTimeStr(startMs + task.duration * 60 * 1000)

  const handleEndChange = (newEndStr) => {
    const startMin  = timeStrToMinutes(startStr)
    const newEndMin = timeStrToMinutes(newEndStr)
    let diff = newEndMin - startMin
    if (diff <= 0) diff += 24 * 60 // midnight crossing
    updateField(task.id, 'duration', Math.max(1, Math.min(480, diff)))
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="flex items-center gap-3 group rounded-lg px-2 py-1 hover:bg-[var(--bg-hover)] transition-colors"
    >
      {/* drag handle */}
      <button
        {...attributes}
        {...listeners}
        className="text-[var(--text-dim)] hover:text-[var(--text-muted)] cursor-grab active:cursor-grabbing shrink-0 touch-none"
        tabIndex={-1}
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

      {/* checkbox */}
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

      {/* task name */}
      <input
        ref={el => { inputRefs.current[task.id] = el }}
        value={task.text}
        onChange={e => updateField(task.id, 'text', e.target.value)}
        onPaste={e => handlePaste(e, task.id)}
        onKeyDown={e => handleKeyDown(e, task.id, idx)}
        placeholder="What are you working on?"
        className={`flex-1 bg-transparent outline-none py-2.5 text-xl placeholder:text-[var(--text-dim)] caret-[var(--text)] text-[var(--text)] ${
          task.completed ? 'line-through opacity-50' : ''
        }`}
      />

      {/* time range + duration + controls (visible on hover) */}
      <div className="flex items-center gap-2 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity shrink-0">
        {isFirst && !sessionActive ? (
          <TimeInput
            value={startStr}
            onChange={onPlannedStartChange}
            className="w-16 bg-[var(--bg-hover)] border border-[var(--border)] rounded px-1.5 py-1 text-xs text-center outline-none focus:border-[var(--text-muted)] text-[var(--text)]"
          />
        ) : (
          <span className="text-[var(--text-muted)] text-xs tabular-nums">{startStr}</span>
        )}
        <span className="text-[var(--text-dim)] text-xs">&rarr;</span>
        <TimeInput
          value={endStr}
          onChange={handleEndChange}
          className="w-16 bg-[var(--bg-hover)] border border-[var(--border)] rounded px-1.5 py-1 text-xs text-center outline-none focus:border-[var(--text-muted)] text-[var(--text)]"
        />

        <input
          type="number"
          value={task.duration}
          onChange={e => updateField(task.id, 'duration', Math.max(1, Number(e.target.value)))}
          className="w-12 bg-[var(--bg-hover)] border border-[var(--border)] rounded px-2 py-1 text-xs text-center outline-none focus:border-[var(--text-muted)] text-[var(--text)]"
          min="1"
          max="480"
        />
        <span className="text-[var(--text-dim)] text-xs">min</span>

        {/* delete */}
        <button
          onClick={() => deleteTask(task.id)}
          className="text-[var(--text-dim)] hover:text-[var(--danger)] transition-colors text-lg leading-none"
        >
          &times;
        </button>
      </div>
    </div>
  )
}
