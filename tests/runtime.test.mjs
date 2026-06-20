import test from 'node:test'
import assert from 'node:assert/strict'

import {
  advanceRuntime,
  anchoredDurationMinutes,
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

// --- Edit-intent / anchor model ------------------------------------------
// Use LOCAL wall-clock construction so assertions are timezone-stable
// (anchored durations resolve against minutesSinceMidnightOf, which is local).
const localMs = (h, m) => new Date(2026, 3, 21, h, m, 0, 0).getTime()

test('end-anchored task preserves its absolute end when the start is forced to now (bug replay)', () => {
  const tasks = [{ id: 't1', text: 'Deep work', anchor: 'end', endMin: 18 * 60, duration: 115, completed: false }]
  const runtime = createRuntimeState({
    tasks,
    plannedStartAt: localMs(16, 5), // planned 16:05 — already in the past
    now: localMs(16, 17),           // clicked Start 12 min late
    settings: {},
  })

  assert.equal(runtime.actualStartAt, localMs(16, 17))     // start snaps to now
  assert.equal(runtime.tasks[0].plannedDurationSeconds, 103 * 60) // duration shrinks 115 -> 103
  const endAt = runtime.actualStartAt + runtime.tasks[0].plannedDurationSeconds * 1000
  assert.equal(endAt, localMs(18, 0))                      // end stays 18:00, not 18:12
})

test('duration-anchored task keeps its length and lets the end slide on a late start', () => {
  const tasks = [{ id: 't1', text: 'Deep work', anchor: 'duration', duration: 115, completed: false }]
  const runtime = createRuntimeState({ tasks, plannedStartAt: localMs(16, 5), now: localMs(16, 17), settings: {} })

  assert.equal(runtime.tasks[0].plannedDurationSeconds, 115 * 60)
  const endAt = runtime.actualStartAt + runtime.tasks[0].plannedDurationSeconds * 1000
  assert.equal(endAt, localMs(18, 12)) // slides forward, as intended for a duration anchor
})

test('an end-anchored later task derives its duration after upstream tasks and breaks', () => {
  const tasks = [
    { id: 't1', text: 'First', anchor: 'duration', duration: 30, completed: false },
    { id: 't2', text: 'Second', anchor: 'end', endMin: 18 * 60, completed: false },
  ]

  const noBreak = createRuntimeState({ tasks, plannedStartAt: localMs(16, 0), now: localMs(16, 0), settings: {} })
  assert.equal(noBreak.tasks[1].plannedDurationSeconds, 90 * 60) // 16:30 -> 18:00

  const withBreak = createRuntimeState({
    tasks,
    plannedStartAt: localMs(16, 0),
    now: localMs(16, 0),
    settings: { breaksEnabled: true, breakDuration: 5 },
  })
  assert.equal(withBreak.tasks[1].plannedDurationSeconds, 85 * 60) // 16:35 -> 18:00 after a 5-min break
})

test('an already-passed end pin clamps to the minimum and flags overdue', () => {
  const tasks = [{ id: 't1', text: 'Late', anchor: 'end', endMin: 17 * 60, completed: false }]
  const runtime = createRuntimeState({ tasks, plannedStartAt: localMs(17, 30), now: localMs(17, 30), settings: {} })

  assert.equal(runtime.tasks[0].plannedDurationSeconds, 60)
  assert.equal(runtime.tasks[0].overdue, true)
})

test('anchoredDurationMinutes distinguishes overdue-today from a genuine overnight task', () => {
  assert.deepEqual(anchoredDurationMinutes(16 * 60 + 17, 18 * 60), { minutes: 103, overdue: false })
  assert.deepEqual(anchoredDurationMinutes(17 * 60 + 30, 17 * 60), { minutes: 1, overdue: true })
  assert.deepEqual(anchoredDurationMinutes(23 * 60, 6 * 60), { minutes: 7 * 60, overdue: false })
})

test('a future planned start waits, then the end-anchored first task ends at its pin', () => {
  const tasks = [{ id: 't1', text: 'Block', anchor: 'end', endMin: 14 * 60, completed: false }]
  const runtime = createRuntimeState({ tasks, plannedStartAt: localMs(13, 0), now: localMs(12, 45), settings: {} })

  assert.equal(runtime.mode, 'waiting')
  assert.equal(runtime.tasks[0].plannedDurationSeconds, 60 * 60) // 13:00 -> 14:00

  const live = deriveRuntimeView(runtime, localMs(13, 0))
  assert.equal(live.mode, 'task')
  const endAt = live.runtime.modeStartedAt + live.runtime.remainingTaskSeconds * 1000
  assert.equal(endAt, localMs(14, 0))
})

test('tasks without anchor fields behave as duration-anchored (back-compat)', () => {
  const tasks = [{ id: 't1', text: 'Legacy', duration: 50, completed: false }]
  const runtime = createRuntimeState({ tasks, plannedStartAt: localMs(9, 0), now: localMs(9, 0), settings: {} })

  assert.equal(runtime.tasks[0].anchor, 'duration')
  assert.equal(runtime.tasks[0].endMin, null)
  assert.equal(runtime.tasks[0].plannedDurationSeconds, 50 * 60)
})

test('runtime snapshot round-trips anchor and endMin', () => {
  const storage = createMockStorage()
  const tasks = [{ id: 't1', text: 'Pinned', anchor: 'end', endMin: 18 * 60, completed: false }]
  const runtime = createRuntimeState({ tasks, plannedStartAt: localMs(16, 0), now: localMs(16, 0), settings: {} })

  saveStoredRuntime(storage, runtime)
  const stored = getStoredRuntime(storage)
  assert.equal(stored.tasks[0].anchor, 'end')
  assert.equal(stored.tasks[0].endMin, 18 * 60)
})

test('full path: a planner end pin survives startSession when started late (auto start)', () => {
  // The shape the planner persists after the user types an end of 18:00, then
  // startSession in auto mode passes plannedStartAt: null so the runtime uses now.
  const persisted = [{ id: 't1', text: 'Deep work', anchor: 'end', endMin: 18 * 60, duration: 115, completed: false }]
  const runtime = createRuntimeState({ tasks: persisted, plannedStartAt: null, now: localMs(16, 17), settings: {} })

  const endAt = runtime.actualStartAt + runtime.tasks[0].plannedDurationSeconds * 1000
  assert.equal(endAt, localMs(18, 0))
})
