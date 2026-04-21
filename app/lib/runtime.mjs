export const RUNTIME_VERSION = 2
export const RUNTIME_STORAGE_KEY = 'focusboard-runtime'
export const LEGACY_TIMING_KEYS = [
  'focusboard-session',
  'focusboard-skip-offset',
  'focusboard-paused-at',
  'focusboard-manual-break',
]

const DEFAULT_BREAK_DURATION_SECONDS = 5 * 60

function cloneValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value)
  return JSON.parse(JSON.stringify(value))
}

function createId(prefix = 'runtime') {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function toValidTasks(tasks = []) {
  return tasks
    .filter(task => task?.text?.trim())
    .map((task, index) => ({
      id: task.id,
      text: task.text.trim(),
      order: index,
      plannedDurationSeconds: Math.max(60, Number(task.duration || 0) * 60),
      status: 'pending',
      actualStartAt: null,
      actualEndAt: null,
      actualFocusSeconds: 0,
    }))
}

function getBreakDurationSeconds(settings = {}) {
  const minutes = Number(settings?.breakDuration ?? 5)
  return Math.max(60, Math.min(60 * 60, minutes * 60))
}

function findTask(runtime, taskId) {
  return runtime.tasks.find(task => task.id === taskId) || null
}

function getPendingTask(runtime) {
  return runtime.tasks.find(task => task.status === 'pending') || null
}

function getOpenSegment(runtime) {
  for (let i = runtime.segments.length - 1; i >= 0; i -= 1) {
    if (!runtime.segments[i].endedAt) return runtime.segments[i]
  }
  return null
}

function openSegment(runtime, type, startedAt, taskId = null) {
  runtime.segments.push({
    id: createId(type),
    type,
    taskId,
    startedAt,
    endedAt: null,
  })
}

function closeSegment(runtime, type, endedAt) {
  const segment = getOpenSegment(runtime)
  if (segment && segment.type === type && !segment.endedAt) {
    segment.endedAt = endedAt
  }
}

function enterDone(runtime, endedAt) {
  runtime.mode = 'done'
  runtime.modeStartedAt = endedAt
  runtime.currentTaskId = null
  runtime.remainingTaskSeconds = 0
  runtime.remainingBreakSeconds = 0
  runtime.actualEndAt = endedAt
  return runtime
}

function startTask(runtime, taskId, startedAt, remainingSeconds = null) {
  const task = findTask(runtime, taskId)
  if (!task) return enterDone(runtime, startedAt)

  runtime.mode = 'task'
  runtime.modeStartedAt = startedAt
  runtime.currentTaskId = task.id
  runtime.remainingBreakSeconds = 0
  runtime.remainingTaskSeconds = remainingSeconds ?? task.plannedDurationSeconds
  task.status = 'active'
  if (!task.actualStartAt) task.actualStartAt = startedAt
  if (!runtime.actualStartAt || startedAt < runtime.actualStartAt) {
    runtime.actualStartAt = startedAt
  }
  openSegment(runtime, 'task', startedAt, task.id)
  return runtime
}

function startNextPendingTask(runtime, startedAt) {
  const nextTask = getPendingTask(runtime)
  if (!nextTask) return enterDone(runtime, startedAt)
  return startTask(runtime, nextTask.id, startedAt, nextTask.plannedDurationSeconds)
}

function startAutoBreak(runtime, startedAt) {
  const nextTask = getPendingTask(runtime)
  if (!runtime.breakSettings.enabled || !nextTask) {
    return startNextPendingTask(runtime, startedAt)
  }

  runtime.mode = 'auto_break'
  runtime.modeStartedAt = startedAt
  runtime.currentTaskId = nextTask.id
  runtime.remainingBreakSeconds = runtime.breakSettings.durationSeconds
  runtime.remainingTaskSeconds = 0
  openSegment(runtime, 'auto_break', startedAt)
  return runtime
}

function consumeTaskFocus(runtime, endedAt) {
  if (runtime.mode !== 'task' || !runtime.currentTaskId) return 0

  const elapsedSeconds = Math.max(0, Math.floor((endedAt - runtime.modeStartedAt) / 1000))
  const consumed = Math.min(runtime.remainingTaskSeconds, elapsedSeconds)
  const task = findTask(runtime, runtime.currentTaskId)
  if (task) {
    task.actualFocusSeconds += consumed
    if (!task.actualStartAt) task.actualStartAt = runtime.modeStartedAt
  }
  runtime.remainingTaskSeconds = Math.max(0, runtime.remainingTaskSeconds - consumed)
  closeSegment(runtime, 'task', endedAt)
  return consumed
}

function finishCurrentTask(runtime, endedAt, status, nextTransition = 'immediate') {
  const activeTaskId = runtime.currentTaskId
  const activeTask = activeTaskId ? findTask(runtime, activeTaskId) : null

  if (runtime.mode === 'task') {
    consumeTaskFocus(runtime, endedAt)
  } else if (runtime.mode === 'paused') {
    closeSegment(runtime, 'pause', endedAt)
  } else if (runtime.mode === 'manual_break') {
    closeSegment(runtime, 'manual_break', endedAt)
  }

  if (activeTask) {
    activeTask.status = status
    if (!activeTask.actualStartAt && status === 'completed') activeTask.actualStartAt = endedAt
    if (activeTask.actualStartAt || activeTask.actualFocusSeconds > 0) {
      activeTask.actualEndAt = endedAt
    }
  }

  runtime.currentTaskId = null
  runtime.remainingTaskSeconds = 0
  runtime.remainingBreakSeconds = 0

  if (nextTransition === 'auto_break') {
    return startAutoBreak(runtime, endedAt)
  }
  return startNextPendingTask(runtime, endedAt)
}

function skipPendingTask(runtime, taskId, endedAt) {
  const task = findTask(runtime, taskId)
  if (!task || task.status !== 'pending') return runtime

  task.status = 'skipped'
  if (runtime.currentTaskId === taskId) {
    const nextTask = getPendingTask(runtime)
    if (!nextTask) return enterDone(runtime, endedAt)
    runtime.currentTaskId = nextTask.id
  }
  return runtime
}

function finishWaitingTasksIfNeeded(runtime, endedAt) {
  if (runtime.mode !== 'waiting') return runtime
  if (endedAt < runtime.plannedStartAt) return runtime
  return startTask(runtime, runtime.currentTaskId, runtime.plannedStartAt)
}

function advanceTask(runtime, now) {
  while (true) {
    if (runtime.mode === 'waiting') {
      if (now < runtime.plannedStartAt) return runtime
      finishWaitingTasksIfNeeded(runtime, now)
      continue
    }

    if (runtime.mode === 'task') {
      const taskEndsAt = runtime.modeStartedAt + runtime.remainingTaskSeconds * 1000
      if (now < taskEndsAt) return runtime
      finishCurrentTask(runtime, taskEndsAt, 'completed', 'auto_break')
      continue
    }

    if (runtime.mode === 'auto_break') {
      const breakEndsAt = runtime.modeStartedAt + runtime.remainingBreakSeconds * 1000
      if (now < breakEndsAt) return runtime
      closeSegment(runtime, 'auto_break', breakEndsAt)
      runtime.remainingBreakSeconds = 0
      startNextPendingTask(runtime, breakEndsAt)
      continue
    }

    return runtime
  }
}

function getModeSecondsLeft(runtime, now) {
  if (runtime.mode === 'waiting') {
    return Math.max(0, Math.ceil((runtime.plannedStartAt - now) / 1000))
  }
  if (runtime.mode === 'task') {
    const elapsedSeconds = Math.max(0, Math.floor((now - runtime.modeStartedAt) / 1000))
    return Math.max(0, runtime.remainingTaskSeconds - elapsedSeconds)
  }
  if (runtime.mode === 'auto_break') {
    const elapsedSeconds = Math.max(0, Math.floor((now - runtime.modeStartedAt) / 1000))
    return Math.max(0, runtime.remainingBreakSeconds - elapsedSeconds)
  }
  if (runtime.mode === 'paused' || runtime.mode === 'manual_break') {
    return runtime.remainingTaskSeconds
  }
  return 0
}

function listPendingTasks(runtime) {
  return runtime.tasks.filter(task => task.status === 'pending')
}

export function createRuntimeState({ tasks, plannedStartAt, now = Date.now(), settings = {} }) {
  const snapshot = toValidTasks(tasks)
  if (!snapshot.length) return null

  const effectiveStartAt = plannedStartAt && plannedStartAt > now ? plannedStartAt : now
  const firstTask = snapshot[0]
  const runtime = {
    version: RUNTIME_VERSION,
    id: createId('focus'),
    createdAt: now,
    plannedStartAt: effectiveStartAt,
    actualStartAt: effectiveStartAt,
    actualEndAt: null,
    archivedAt: null,
    breakSettings: {
      enabled: !!settings?.breaksEnabled,
      durationSeconds: getBreakDurationSeconds(settings),
    },
    mode: effectiveStartAt > now ? 'waiting' : 'task',
    modeStartedAt: effectiveStartAt > now ? now : effectiveStartAt,
    currentTaskId: firstTask.id,
    remainingTaskSeconds: firstTask.plannedDurationSeconds,
    remainingBreakSeconds: 0,
    tasks: snapshot,
    segments: [],
  }

  if (runtime.mode === 'task') {
    startTask(runtime, firstTask.id, effectiveStartAt, firstTask.plannedDurationSeconds)
  }

  return runtime
}

export function advanceRuntime(runtime, now = Date.now()) {
  if (!runtime) return null
  const next = cloneValue(runtime)
  return advanceTask(next, now)
}

export function applyRuntimeAction(runtime, action, now = Date.now()) {
  if (!runtime) return null

  const next = advanceRuntime(runtime, now)
  if (!action?.type) return next

  if (action.type === 'pause') {
    if (next.mode !== 'task' || !next.currentTaskId) return next
    consumeTaskFocus(next, now)
    next.mode = 'paused'
    next.modeStartedAt = now
    openSegment(next, 'pause', now, next.currentTaskId)
    return next
  }

  if (action.type === 'resume') {
    if (next.mode === 'paused') {
      closeSegment(next, 'pause', now)
      return startTask(next, next.currentTaskId, now, next.remainingTaskSeconds)
    }
    if (next.mode === 'manual_break') {
      closeSegment(next, 'manual_break', now)
      return startTask(next, next.currentTaskId, now, next.remainingTaskSeconds)
    }
    return next
  }

  if (action.type === 'start_manual_break') {
    if (next.mode !== 'task' || !next.currentTaskId) return next
    consumeTaskFocus(next, now)
    next.mode = 'manual_break'
    next.modeStartedAt = now
    openSegment(next, 'manual_break', now, next.currentTaskId)
    return next
  }

  if (action.type === 'skip_break') {
    if (next.mode !== 'auto_break') return next
    closeSegment(next, 'auto_break', now)
    next.remainingBreakSeconds = 0
    return startNextPendingTask(next, now)
  }

  if (action.type === 'skip_task') {
    if (!next.currentTaskId) return next
    if (!['task', 'paused', 'manual_break'].includes(next.mode)) return next
    return finishCurrentTask(next, now, 'skipped', 'immediate')
  }

  if (action.type === 'complete_task') {
    if (!next.currentTaskId) return next
    if (!['task', 'paused', 'manual_break'].includes(next.mode)) return next
    return finishCurrentTask(next, now, 'completed', 'immediate')
  }

  if (action.type === 'toggle_task_from_planner') {
    const task = findTask(next, action.taskId)
    if (!task || !action.completed) return next

    if (next.mode === 'waiting' && task.id === next.currentTaskId) {
      task.status = 'skipped'
      const remaining = listPendingTasks(next)
      const nextPending = remaining.find(candidate => candidate.id !== task.id)
      if (!nextPending) return enterDone(next, now)
      next.currentTaskId = nextPending.id
      return next
    }

    if (task.id === next.currentTaskId && ['task', 'paused', 'manual_break'].includes(next.mode)) {
      return finishCurrentTask(next, now, 'completed', 'immediate')
    }

    if (task.status === 'pending') {
      skipPendingTask(next, task.id, now)
    }
    return next
  }

  if (action.type === 'mark_archived') {
    next.archivedAt = now
    return next
  }

  return next
}

export function deriveRuntimeView(runtime, now = Date.now()) {
  if (!runtime) {
    return {
      runtime: null,
      mode: 'idle',
      currentTask: null,
      nextTask: null,
      secondsLeft: 0,
      waitingToStart: false,
      isOnBreak: false,
      paused: false,
      manualBreak: false,
      allDone: false,
      predictedEndAt: null,
    }
  }

  const settled = advanceRuntime(runtime, now)
  const currentTask = settled.currentTaskId ? findTask(settled, settled.currentTaskId) : null
  const pendingTasks = listPendingTasks(settled)
  const nextTask = currentTask
    ? pendingTasks.find(task => task.id !== currentTask.id) || null
    : pendingTasks[0] || null

  return {
    runtime: settled,
    mode: settled.mode,
    currentTask,
    nextTask,
    secondsLeft: getModeSecondsLeft(settled, now),
    waitingToStart: settled.mode === 'waiting',
    isOnBreak: settled.mode === 'auto_break',
    paused: settled.mode === 'paused',
    manualBreak: settled.mode === 'manual_break',
    allDone: settled.mode === 'done',
    predictedEndAt: estimateRuntimeEnd(settled, now),
  }
}

export function estimateRuntimeEnd(runtime, now = Date.now()) {
  if (!runtime) return null
  const settled = advanceRuntime(runtime, now)
  if (settled.mode === 'done') return settled.actualEndAt
  if (settled.mode === 'paused' || settled.mode === 'manual_break') return null

  let cursor = now
  if (settled.mode === 'waiting') {
    cursor = settled.plannedStartAt
  } else if (settled.mode === 'task') {
    cursor += getModeSecondsLeft(settled, now) * 1000
  } else if (settled.mode === 'auto_break') {
    cursor += getModeSecondsLeft(settled, now) * 1000
  }

  const working = advanceRuntime(settled, cursor)
  if (working.mode === 'done') return working.actualEndAt

  let simulated = cloneValue(working)
  while (simulated.mode !== 'done') {
    if (simulated.mode === 'task') {
      simulated = advanceRuntime(simulated, simulated.modeStartedAt + simulated.remainingTaskSeconds * 1000)
      continue
    }
    if (simulated.mode === 'auto_break') {
      simulated = advanceRuntime(simulated, simulated.modeStartedAt + simulated.remainingBreakSeconds * 1000)
      continue
    }
    if (simulated.mode === 'waiting') {
      simulated = advanceRuntime(simulated, simulated.plannedStartAt)
      continue
    }
    return null
  }
  return simulated.actualEndAt
}

export function hasRuntimeProgress(runtime) {
  if (!runtime) return false
  if (runtime.mode !== 'waiting') return true
  return runtime.tasks.some(task => task.status !== 'pending' || task.actualFocusSeconds > 0)
}

export function finalizeHistorySession(runtime, { now = Date.now(), date } = {}) {
  if (!runtime) return null
  const settled = advanceRuntime(runtime, now)
  const finalized = cloneValue(settled)

  if (finalized.mode === 'task' && finalized.currentTaskId) {
    consumeTaskFocus(finalized, now)
    const currentTask = findTask(finalized, finalized.currentTaskId)
    if (currentTask && (currentTask.actualStartAt || currentTask.actualFocusSeconds > 0)) {
      currentTask.actualEndAt = now
    }
    finalized.actualEndAt = now
  } else if (finalized.mode === 'paused' && finalized.currentTaskId) {
    closeSegment(finalized, 'pause', now)
    const currentTask = findTask(finalized, finalized.currentTaskId)
    if (currentTask && (currentTask.actualStartAt || currentTask.actualFocusSeconds > 0)) {
      currentTask.actualEndAt = now
    }
    finalized.actualEndAt = now
  } else if (finalized.mode === 'manual_break' && finalized.currentTaskId) {
    closeSegment(finalized, 'manual_break', now)
    const currentTask = findTask(finalized, finalized.currentTaskId)
    if (currentTask && (currentTask.actualStartAt || currentTask.actualFocusSeconds > 0)) {
      currentTask.actualEndAt = now
    }
    finalized.actualEndAt = now
  } else if (finalized.mode === 'auto_break') {
    closeSegment(finalized, 'auto_break', now)
    finalized.actualEndAt = now
  }

  const focusSeconds = finalized.tasks.reduce((sum, task) => sum + task.actualFocusSeconds, 0)
  const pauseSeconds = finalized.segments
    .filter(segment => segment.type === 'pause' && segment.endedAt)
    .reduce((sum, segment) => sum + Math.max(0, Math.round((segment.endedAt - segment.startedAt) / 1000)), 0)
  const breakSeconds = finalized.segments
    .filter(segment => ['manual_break', 'auto_break'].includes(segment.type) && segment.endedAt)
    .reduce((sum, segment) => sum + Math.max(0, Math.round((segment.endedAt - segment.startedAt) / 1000)), 0)

  const totalMinutes = finalized.tasks.reduce((sum, task) => sum + Math.round(task.plannedDurationSeconds / 60), 0)
  const completedTasks = finalized.tasks.filter(task => task.status === 'completed').length
  const skippedTasks = finalized.tasks.filter(task => task.status === 'skipped').length
  const actualStartAt = finalized.actualStartAt
  const actualEndAt = finalized.actualEndAt ?? now

  return {
    schemaVersion: RUNTIME_VERSION,
    id: finalized.id,
    date,
    startTime: actualStartAt,
    endTime: actualEndAt,
    plannedStartAt: finalized.plannedStartAt,
    actualStartAt,
    actualEndAt,
    focusSeconds,
    pauseSeconds,
    breakSeconds,
    totalTasks: finalized.tasks.length,
    completedTasks,
    skippedTasks,
    totalMinutes,
    tasks: finalized.tasks.map(task => ({
      id: task.id,
      text: task.text,
      duration: Math.round(task.plannedDurationSeconds / 60),
      status: task.status,
      completed: task.status === 'completed',
      skipped: task.status === 'skipped',
      actualStartAt: task.actualStartAt,
      actualEndAt: task.actualEndAt,
      actualFocusSeconds: task.actualFocusSeconds,
    })),
  }
}

export function projectPlannerTasks(tasks, runtime) {
  if (!runtime) return tasks
  const taskMap = new Map(runtime.tasks.map(task => [task.id, task]))
  return tasks.map(task => {
    const runtimeTask = taskMap.get(task.id)
    if (!runtimeTask) return task
    return {
      ...task,
      completed: runtimeTask.status === 'completed' || runtimeTask.status === 'skipped',
      runtimeStatus: runtimeTask.status,
    }
  })
}

export function getStoredRuntime(storage) {
  try {
    const raw = storage.getItem(RUNTIME_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw)
    return parsed?.version === RUNTIME_VERSION ? parsed : null
  } catch {
    return null
  }
}

export function saveStoredRuntime(storage, runtime) {
  if (!runtime) {
    storage.removeItem(RUNTIME_STORAGE_KEY)
    return
  }
  storage.setItem(RUNTIME_STORAGE_KEY, JSON.stringify(runtime))
}

export function clearLegacyTimingState(storage, { clearPlannedStart = false } = {}) {
  for (const key of LEGACY_TIMING_KEYS) storage.removeItem(key)
  if (clearPlannedStart) storage.removeItem('focusboard-planned-start')
}

export function migrateLegacySession(storage, { date, now = Date.now() } = {}) {
  const hasLegacy = LEGACY_TIMING_KEYS.some(key => !!storage.getItem(key))
  if (!hasLegacy) return { migrated: false, session: null }

  let session = null
  try {
    const rawTasks = storage.getItem('focusboard-tasks')
    const rawStart = storage.getItem('focusboard-session')
    const tasks = rawTasks ? JSON.parse(rawTasks).filter(task => task?.text?.trim()) : []
    const completedTasks = tasks.filter(task => task.completed)

    if (rawStart && completedTasks.length > 0) {
      session = {
        schemaVersion: 1,
        id: createId('legacy'),
        date,
        legacyMigrated: true,
        startTime: Number(rawStart),
        endTime: now,
        tasks: tasks.map(task => ({
          text: task.text,
          duration: Number(task.duration || 0),
          completed: !!task.completed,
          skipped: false,
          status: task.completed ? 'completed' : 'pending',
        })),
        totalTasks: tasks.length,
        completedTasks: completedTasks.length,
        skippedTasks: 0,
        totalMinutes: tasks.reduce((sum, task) => sum + Number(task.duration || 0), 0),
      }
    }
  } catch {
    session = null
  }

  clearLegacyTimingState(storage, { clearPlannedStart: true })
  return { migrated: true, session }
}
