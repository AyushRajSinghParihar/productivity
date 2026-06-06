import { minutesSinceMidnightOf, anchoredDurationMinutes, isBreakItem } from './runtime.mjs'

// Pure, clock-injectable planner scheduling math. Kept free of React/Next so it
// runs under `node --test` (see tests/schedule.test.mjs). manage/page.jsx is a
// thin consumer that passes its live `now` in.

export function msToTimeStr(ms) {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function timeStrToMinutes(str) {
  const [h, m] = str.split(':').map(Number)
  return h * 60 + m
}

// Round up to the next 5-minute boundary — the default "starting now" base.
function roundedNow(now) {
  const remainder = (5 - (Math.floor(now / 60000) % 5)) % 5
  return now + remainder * 60000
}

function parseTimeToday(plannedStart, now) {
  const [h, m] = plannedStart.split(':').map(Number)
  const d = new Date(now)
  d.setHours(h, m, 0, 0)
  return d.getTime()
}

// Materialize the schedule for a task list. Returns absolute start/end
// timestamps per row plus an `overdue` flag. End-anchored rows (anchor === 'end'
// with an endMin) hold their absolute end and derive duration from the chain;
// every other row keeps its duration and lets its end fall out of the chain.
//
//   base:  active session  -> sessionStartAt
//          fixed + future   -> the pinned time today
//          else (auto / fixed-past / none) -> now rounded to next 5 min
export function computeStartTimes(
  tasks,
  { sessionStartAt, plannedStart, plannedStartMode = 'auto', breaksEnabled = false, breakDurationMinutes = 0 } = {},
  now = Date.now()
) {
  let base
  if (sessionStartAt) {
    base = sessionStartAt
  } else if (plannedStartMode === 'fixed' && plannedStart) {
    const parsed = parseTimeToday(plannedStart, now)
    base = parsed > now ? parsed : roundedNow(now)
  } else {
    base = roundedNow(now)
  }

  const starts = []
  const ends = []
  const overdue = []
  let cursor = base

  for (let index = 0; index < tasks.length; index += 1) {
    const task = tasks[index]
    starts.push(cursor)

    let durationMs
    if (task.anchor === 'end' && task.endMin != null) {
      const res = anchoredDurationMinutes(minutesSinceMidnightOf(cursor), task.endMin)
      durationMs = Math.max(1, res.minutes) * 60 * 1000
      overdue.push(res.overdue)
    } else {
      durationMs = Math.max(1, Number(task.duration) || 0) * 60 * 1000
      overdue.push(false)
    }

    const end = cursor + durationMs
    ends.push(end)
    cursor = end

    // Settings auto-break only falls between two real tasks — never after a
    // break row or right before a planned break (mirrors runtime startAutoBreak).
    const currentIsRealTask = !isBreakItem(task) && !!task.text?.trim()
    const nextIsBreak = isBreakItem(tasks[index + 1])
    const hasFutureRealTask = tasks
      .slice(index + 1)
      .some(candidate => !isBreakItem(candidate) && candidate.text?.trim())

    if (breaksEnabled && currentIsRealTask && !nextIsBreak && hasFutureRealTask) {
      cursor += breakDurationMinutes * 60 * 1000
    }
  }

  return { starts, ends, overdue }
}
