# main — Test Contract

## Functional Behavior
- Starting a session snapshots the task list, task order, task durations, planned start time, and break settings into one runtime object. Edits made afterward do not change the active session.
- If the planned start time is in the future, the dashboard stays in a waiting state until that time and the first task does not begin early.
- The original session start timestamp never changes after the session begins.
- Auto-breaks occur only between completed timed tasks when breaks were enabled in the session snapshot and another pending task exists.
- Manual `Pause` and `Take a Break` stop elapsed focus time without rewriting the task timeline. Resuming returns to the same active task with the same remaining focus time.
- A 1 PM session followed by a 2 hour manual break resumes the same task, records a 2 hour break segment, keeps the task's actual focus duration unchanged, and extends the actual session end by 2 hours.
- `Skip` ends the current task immediately, marks it skipped, and starts the next pending task immediately without inserting an auto-break.
- `Skip break` only ends the current auto-break and starts the next task. It must never mark that next task complete.
- Completing a task early via the planner checkbox compresses the schedule immediately. Completing a future task from the planner removes it from the remaining queue.
- Reset, day rollover, and session completion archive history using actual runtime timing instead of inferring it from mutable planner rows.
- Existing history entries without detailed timing continue to render.

## Unit Tests
- `createRuntimeState` snapshots tasks and settings into a versioned runtime object.
- `deriveRuntimeView` returns `waiting`, `task`, `paused`, `manual_break`, `auto_break`, and `done` states at the correct timestamps.
- `applyRuntimeAction` handles `pause`, `resume`, `startManualBreak`, `endManualBreak`, `skipTask`, `skipBreak`, `completeTask`, and `toggleTaskFromPlanner` without corrupting the session timeline.
- `finalizeHistorySession` derives session totals, per-task actual timing, and break totals from runtime segments.
- `migrateLegacySession` archives any safely-detectable completed progress and clears incompatible live timing state.

## Integration / Functional Tests
- Dashboard countdown and manage page summary stay consistent across reloads with an active session.
- Starting a session freezes the runtime snapshot while planner edits only affect the next session.
- Resetting an active session saves a partial history entry with actual timing.
- Day rollover archives completed progress and clears the active runtime.

## Smoke Tests
- `npm test` passes.
- `npm run build` passes.

## E2E Tests
- N/A — no browser E2E harness exists in this repo.

## Manual / cURL Tests
1. Start a session with breaks enabled, let task 1 expire, and confirm the dashboard shows an auto-break instead of jumping into task 2.
2. During the auto-break, press `Skip break` and confirm task 2 starts immediately and is not marked complete.
3. Start a task, press `Take a Break`, wait, then resume and confirm the same task still has the same remaining countdown.
4. Start at 1 PM, take a long manual break, resume, and confirm history shows the original start plus added break time rather than an inflated task duration.
5. Edit task durations after a session starts and confirm the live countdown does not change until the next session.
