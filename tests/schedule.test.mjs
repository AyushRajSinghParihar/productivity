import test from 'node:test'
import assert from 'node:assert/strict'

import { computeStartTimes, msToTimeStr } from '../app/lib/schedule.mjs'

// Local wall-clock construction so assertions are timezone-stable.
const localMs = (h, m) => new Date(2026, 3, 21, h, m, 0, 0).getTime()
const hhmm = ms => msToTimeStr(ms)

test('base selection: auto rounds now up to the next 5-min boundary', () => {
  const { starts } = computeStartTimes(
    [{ id: 't1', text: 'A', duration: 30 }],
    { plannedStartMode: 'auto' },
    localMs(16, 17),
  )
  assert.equal(hhmm(starts[0]), '16:20')
})

test('base selection: a fixed future start anchors at the pinned time', () => {
  const { starts } = computeStartTimes(
    [{ id: 't1', text: 'A', duration: 30 }],
    { plannedStartMode: 'fixed', plannedStart: '17:00' },
    localMs(16, 17),
  )
  assert.equal(hhmm(starts[0]), '17:00')
})

test('base selection: a fixed but past start falls back to rounded-now (mirrors Start)', () => {
  const { starts } = computeStartTimes(
    [{ id: 't1', text: 'A', duration: 30 }],
    { plannedStartMode: 'fixed', plannedStart: '16:05' },
    localMs(16, 17),
  )
  assert.equal(hhmm(starts[0]), '16:20')
})

test('end-anchored row holds its absolute end and derives a shrinking duration', () => {
  const { starts, ends, overdue } = computeStartTimes(
    [{ id: 't1', text: 'Deep work', anchor: 'end', endMin: 18 * 60 }],
    { plannedStartMode: 'auto' },
    localMs(16, 17),
  )
  assert.equal(hhmm(starts[0]), '16:20') // auto base
  assert.equal(hhmm(ends[0]), '18:00')   // end pin held
  assert.equal(overdue[0], false)
})

test('an end pin in the past flags overdue', () => {
  const { overdue } = computeStartTimes(
    [{ id: 't1', text: 'Late', anchor: 'end', endMin: 16 * 60 }],
    { plannedStartMode: 'fixed', plannedStart: '17:00' },
    localMs(17, 0),
  )
  assert.equal(overdue[0], true)
})

test('duration-anchored row ends at start + duration', () => {
  const { starts, ends } = computeStartTimes(
    [{ id: 't1', text: 'A', anchor: 'duration', duration: 45 }],
    { plannedStartMode: 'fixed', plannedStart: '09:00' },
    localMs(8, 0),
  )
  assert.equal(hhmm(starts[0]), '09:00')
  assert.equal(hhmm(ends[0]), '09:45')
})

test('multi-task chaining accounts for durations and inter-task breaks', () => {
  const tasks = [
    { id: 't1', text: 'A', duration: 30 },
    { id: 't2', text: 'B', duration: 20 },
  ]

  const noBreak = computeStartTimes(tasks, { plannedStartMode: 'fixed', plannedStart: '09:00' }, localMs(8, 0))
  assert.equal(hhmm(noBreak.starts[1]), '09:30')
  assert.equal(hhmm(noBreak.ends[1]), '09:50')

  const withBreak = computeStartTimes(
    tasks,
    { plannedStartMode: 'fixed', plannedStart: '09:00', breaksEnabled: true, breakDurationMinutes: 5 },
    localMs(8, 0),
  )
  assert.equal(hhmm(withBreak.starts[1]), '09:35') // 5-min break after A
  assert.equal(hhmm(withBreak.ends[1]), '09:55')
})

test('cross-midnight: a far-backward end pin is treated as next day', () => {
  const { starts, ends, overdue } = computeStartTimes(
    [{ id: 't1', text: 'Overnight', anchor: 'end', endMin: 6 * 60 }],
    { plannedStartMode: 'fixed', plannedStart: '23:00' },
    localMs(22, 0),
  )
  assert.equal(hhmm(starts[0]), '23:00')
  assert.equal(overdue[0], false)
  assert.equal(hhmm(ends[0]), '06:00')                 // wall-clock 06:00 next day
  assert.equal((ends[0] - starts[0]) / 3600000, 7)     // 7 hours
})

test('end-anchored row after a break row holds its absolute end in the preview', () => {
  const tasks = [
    { id: 'a', text: 'A', duration: 30 },
    { id: 'br', type: 'break', text: 'Tea', duration: 10 },
    { id: 'b', text: 'B', anchor: 'end', endMin: 18 * 60 },
  ]
  const { ends } = computeStartTimes(tasks, { plannedStartMode: 'fixed', plannedStart: '16:00' }, localMs(8, 0))
  assert.equal(hhmm(ends[1]), '16:40') // break runs 16:30 -> 16:40
  assert.equal(hhmm(ends[2]), '18:00') // end pin held across the break
})
