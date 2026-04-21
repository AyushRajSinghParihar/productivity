import test from 'node:test'
import assert from 'node:assert/strict'

import {
  advanceRuntime,
  applyRuntimeAction,
  createRuntimeState,
  deriveRuntimeView,
  finalizeHistorySession,
  getStoredRuntime,
  migrateLegacySession,
  RUNTIME_STORAGE_KEY,
  saveStoredRuntime,
} from '../app/lib/runtime.mjs'

function createTasks() {
  return [
    { id: 'task-a', text: 'Task A', duration: 60, completed: false },
    { id: 'task-b', text: 'Task B', duration: 30, completed: false },
    { id: 'task-c', text: 'Task C', duration: 15, completed: false },
  ]
}

function createMockStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null
    },
    setItem(key, value) {
      store.set(key, String(value))
    },
    removeItem(key) {
      store.delete(key)
    },
  }
}

test('createRuntimeState snapshots tasks and settings into versioned runtime state', () => {
  const base = Date.parse('2026-04-21T13:00:00Z')
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt: base,
    now: base,
    settings: { breaksEnabled: true, breakDuration: 7 },
  })

  assert.equal(runtime.version, 2)
  assert.equal(runtime.mode, 'task')
  assert.equal(runtime.breakSettings.enabled, true)
  assert.equal(runtime.breakSettings.durationSeconds, 7 * 60)
  assert.equal(runtime.tasks.length, 3)
  assert.equal(runtime.tasks[0].text, 'Task A')
  assert.equal(runtime.tasks[0].plannedDurationSeconds, 60 * 60)
  assert.equal(runtime.tasks[0].status, 'active')
})

test('deriveRuntimeView stays in waiting mode until the planned start time', () => {
  const now = Date.parse('2026-04-21T12:45:00Z')
  const plannedStartAt = Date.parse('2026-04-21T13:00:00Z')
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt,
    now,
    settings: { breaksEnabled: false },
  })

  const waitingView = deriveRuntimeView(runtime, now)
  assert.equal(waitingView.mode, 'waiting')
  assert.equal(waitingView.waitingToStart, true)
  assert.equal(waitingView.secondsLeft, 15 * 60)

  const liveView = deriveRuntimeView(runtime, plannedStartAt)
  assert.equal(liveView.mode, 'task')
  assert.equal(liveView.currentTask.text, 'Task A')
  assert.equal(liveView.secondsLeft, 60 * 60)
})

test('natural task expiry enters auto-break and skip_break does not complete the next task', () => {
  const base = Date.parse('2026-04-21T13:00:00Z')
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt: base,
    now: base,
    settings: { breaksEnabled: true, breakDuration: 5 },
  })

  const atAutoBreak = advanceRuntime(runtime, base + 60 * 60 * 1000)
  const autoBreakView = deriveRuntimeView(atAutoBreak, base + 60 * 60 * 1000)
  assert.equal(autoBreakView.mode, 'auto_break')
  assert.equal(autoBreakView.currentTask.text, 'Task B')
  assert.equal(autoBreakView.secondsLeft, 5 * 60)

  const afterSkipBreak = applyRuntimeAction(atAutoBreak, { type: 'skip_break' }, base + 60 * 60 * 1000 + 2 * 60 * 1000)
  const resumedView = deriveRuntimeView(afterSkipBreak, base + 60 * 60 * 1000 + 2 * 60 * 1000)
  assert.equal(resumedView.mode, 'task')
  assert.equal(resumedView.currentTask.text, 'Task B')
  assert.equal(afterSkipBreak.tasks.find(task => task.id === 'task-b').status, 'active')
})

test('skip_task ends the current task immediately and starts the next task without an auto-break', () => {
  const base = Date.parse('2026-04-21T13:00:00Z')
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt: base,
    now: base,
    settings: { breaksEnabled: true, breakDuration: 5 },
  })

  const skipped = applyRuntimeAction(runtime, { type: 'skip_task' }, base + 10 * 60 * 1000)
  const view = deriveRuntimeView(skipped, base + 10 * 60 * 1000)

  assert.equal(view.mode, 'task')
  assert.equal(view.currentTask.text, 'Task B')
  assert.equal(skipped.tasks.find(task => task.id === 'task-a').status, 'skipped')
  assert.equal(skipped.segments.some(segment => segment.type === 'auto_break' && !segment.endedAt), false)
})

test('manual breaks preserve the same task and record actual break time in history', () => {
  const base = Date.parse('2026-04-21T13:00:00Z')
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt: base,
    now: base,
    settings: { breaksEnabled: false },
  })

  const onBreak = applyRuntimeAction(runtime, { type: 'start_manual_break' }, base + 15 * 60 * 1000)
  const resumed = applyRuntimeAction(onBreak, { type: 'resume' }, base + 15 * 60 * 1000 + 2 * 60 * 60 * 1000)
  const resumedView = deriveRuntimeView(resumed, base + 15 * 60 * 1000 + 2 * 60 * 60 * 1000)
  assert.equal(resumedView.mode, 'task')
  assert.equal(resumedView.currentTask.text, 'Task A')
  assert.equal(resumedView.secondsLeft, 45 * 60)

  const finished = advanceRuntime(resumed, base + 15 * 60 * 1000 + 2 * 60 * 60 * 1000 + 45 * 60 * 1000 + 30 * 60 * 1000 + 15 * 60 * 1000)
  const history = finalizeHistorySession(finished, {
    now: finished.actualEndAt,
    date: '2026-04-21',
  })

  assert.equal(history.breakSeconds, 2 * 60 * 60)
  assert.equal(history.tasks[0].actualFocusSeconds, 60 * 60)
  assert.equal(history.startTime, base)
  assert.equal(history.endTime, base + 3 * 60 * 60 * 1000 + 30 * 60 * 1000 + 15 * 60 * 1000)
})

test('finalizeHistorySession includes in-progress focus when a session is reset mid-task', () => {
  const base = Date.parse('2026-04-21T13:00:00Z')
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt: base,
    now: base,
    settings: { breaksEnabled: false },
  })

  const history = finalizeHistorySession(runtime, {
    now: base + 10 * 60 * 1000,
    date: '2026-04-21',
  })

  assert.equal(history.focusSeconds, 10 * 60)
  assert.equal(history.tasks[0].actualFocusSeconds, 10 * 60)
  assert.equal(history.tasks[0].actualEndAt, base + 10 * 60 * 1000)
  assert.equal(history.endTime, base + 10 * 60 * 1000)
})

test('planner completion finishes the current task now and future planner completion removes future work as skipped', () => {
  const base = Date.parse('2026-04-21T13:00:00Z')
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt: base,
    now: base,
    settings: { breaksEnabled: true, breakDuration: 5 },
  })

  const withoutFutureTask = applyRuntimeAction(runtime, {
    type: 'toggle_task_from_planner',
    taskId: 'task-c',
    completed: true,
  }, base + 5 * 60 * 1000)

  assert.equal(withoutFutureTask.tasks.find(task => task.id === 'task-c').status, 'skipped')

  const completedCurrent = applyRuntimeAction(withoutFutureTask, {
    type: 'toggle_task_from_planner',
    taskId: 'task-a',
    completed: true,
  }, base + 10 * 60 * 1000)

  const view = deriveRuntimeView(completedCurrent, base + 10 * 60 * 1000)
  assert.equal(completedCurrent.tasks.find(task => task.id === 'task-a').status, 'completed')
  assert.equal(view.mode, 'task')
  assert.equal(view.currentTask.text, 'Task B')
})

test('runtime storage round-trips cleanly', () => {
  const base = Date.parse('2026-04-21T13:00:00Z')
  const storage = createMockStorage()
  const runtime = createRuntimeState({
    tasks: createTasks(),
    plannedStartAt: base,
    now: base,
    settings: { breaksEnabled: false },
  })

  saveStoredRuntime(storage, runtime)
  const stored = getStoredRuntime(storage)

  assert.equal(storage.getItem(RUNTIME_STORAGE_KEY) !== null, true)
  assert.equal(stored.id, runtime.id)
  assert.equal(stored.tasks.length, runtime.tasks.length)
})

test('migrateLegacySession archives safe completed progress and clears incompatible timer keys', () => {
  const storage = createMockStorage({
    'focusboard-session': String(Date.parse('2026-04-21T13:00:00Z')),
    'focusboard-skip-offset': '120',
    'focusboard-paused-at': String(Date.parse('2026-04-21T13:30:00Z')),
    'focusboard-manual-break': '1',
    'focusboard-planned-start': '13:00',
    'focusboard-tasks': JSON.stringify([
      { id: 'task-a', text: 'Task A', duration: 60, completed: true },
      { id: 'task-b', text: 'Task B', duration: 30, completed: false },
    ]),
  })

  const migrated = migrateLegacySession(storage, { date: '2026-04-21', now: Date.parse('2026-04-21T15:00:00Z') })

  assert.equal(migrated.migrated, true)
  assert.equal(migrated.session.completedTasks, 1)
  assert.equal(storage.getItem('focusboard-session'), null)
  assert.equal(storage.getItem('focusboard-planned-start'), null)
})
