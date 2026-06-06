# main — Test Contract

## Functional Behavior
- Starting a session snapshots the task list, task order, task durations, planned start time, and break settings into one runtime object. Edits made afterward do not change the active session.
- If the planned start time is in the future, the dashboard stays in a waiting state until that time and the first task does not begin early.
- The original session start timestamp never changes after the session begins.
- Editing a task's end pins its end time; editing its duration pins its length; editing the first task's start pins the session start. The most recently edited field is held and the unpinned one is recomputed against `end = start + duration`.
- When a session starts after its planned time, end-anchored tasks keep their absolute end (duration shrinks to absorb the late start) while duration-anchored tasks keep their length (the end slides). An unpinned (auto) planned start follows the current time; only a user-pinned future start produces a waiting countdown.
- A pinned end already in the past clamps to the minimum task length and is flagged overdue; the session still starts. A backward end gap is treated as overdue-today unless it exceeds 12 hours, in which case it is a genuine next-day (overnight) end.
- Auto-breaks occur only between completed timed tasks when breaks were enabled in the session snapshot and another pending task exists.
- Planned break blocks are explicit rest items the user places (and reorders) in the task list. When a break's turn comes it runs as its own auto-advancing countdown for its set duration, then the next task starts automatically. `Skip break` ends it early.
- A planned break suppresses any adjacent auto-break (never two rests back to back), runs regardless of whether auto-breaks are enabled, may appear first, last, or back-to-back, and is counted as break time — never as a task — in history. A list containing only breaks (no real task) cannot start a session.
- Manual `Pause` and `Take a Break` stop elapsed focus time without rewriting the task timeline. Resuming returns to the same active task with the same remaining focus time.
- A 1 PM session followed by a 2 hour manual break resumes the same task, records a 2 hour break segment, keeps the task's actual focus duration unchanged, and extends the actual session end by 2 hours.
- `Skip` ends the current task immediately, marks it skipped, and starts the next pending task immediately without inserting an auto-break.
- `Skip break` only ends the current auto-break and starts the next task. It must never mark that next task complete.
- Completing a task early via the planner checkbox compresses the schedule immediately. Completing a future task from the planner removes it from the remaining queue.
- Reset, day rollover, and session completion archive history using actual runtime timing instead of inferring it from mutable planner rows.
- Existing history entries without detailed timing continue to render.

## Unit Tests
- `createRuntimeState` snapshots tasks and settings into a versioned runtime object.
- `deriveRuntimeView` returns `waiting`, `task`, `paused`, `manual_break`, `auto_break`, `planned_break`, and `done` states at the correct timestamps.
- `applyRuntimeAction` handles `pause`, `resume`, `startManualBreak`, `endManualBreak`, `skipTask`, `skipBreak`, `skipPlannedBreak`, `completeTask`, and `toggleTaskFromPlanner` without corrupting the session timeline.
- A planned break runs as its own countdown, suppresses the adjacent auto-break, advances to the next task on expiry or `skipPlannedBreak`, keeps `estimateRuntimeEnd` finite, and is excluded from task totals while counted in break totals.
- `finalizeHistorySession` derives session totals, per-task actual timing, and break totals from runtime segments.
- `migrateLegacySession` archives any safely-detectable completed progress and clears incompatible live timing state.
- `createRuntimeState` recomputes end-anchored task durations against the effective (possibly forced-to-now) start so absolute ends are preserved; `computeStartTimes` (schedule.mjs) materializes per-row start/end/overdue from the same `anchoredDurationMinutes` rule. Both are covered with injected clocks, including the open-16:05 / pin-18:00 / start-16:17 → end-18:00 replay.

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
6. Open the planner, note the time, type an end on task 1, wait a couple of minutes, then Start: the dashboard's first-task end equals the typed end (not end + the elapsed typing time). Repeat setting a duration instead and confirm the end slides forward by the elapsed time.
7. Type an end a couple of minutes in the past and confirm the row is flagged (danger) but Start still works.
8. Add a break between two tasks, confirm the second task's start time and the wrap-up estimate shift by the break length, then start the session and confirm task 1 flows into a green break countdown that auto-advances to task 2; `Skip break` jumps straight to task 2.
9. With auto-breaks enabled, place a planned break and confirm only one rest occurs around it (no double break). Finish a session containing a break and confirm history counts it under breaks, not tasks.
