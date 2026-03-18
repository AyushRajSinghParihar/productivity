'use client'
import { useState, useRef } from 'react'

function parseTimeStr(raw) {
  let str = raw.trim().toLowerCase()

  // Detect am/pm
  let isPm = false
  let isAm = false
  if (str.endsWith('pm') || str.endsWith('p')) {
    isPm = true
    str = str.replace(/\s*(pm|p)$/, '')
  } else if (str.endsWith('am') || str.endsWith('a')) {
    isAm = true
    str = str.replace(/\s*(am|a)$/, '')
  }

  str = str.trim()
  let hours = 0
  let minutes = 0

  if (str.includes(':')) {
    const [hStr, mStr] = str.split(':')
    hours = parseInt(hStr, 10) || 0
    minutes = parseInt(mStr, 10) || 0
  } else {
    const num = parseInt(str, 10)
    if (isNaN(num)) return null
    if (str.length <= 2) {
      // 1-2 digits: treat as hour
      hours = num
      minutes = 0
    } else {
      // 3-4 digits: last 2 are minutes
      minutes = num % 100
      hours = Math.floor(num / 100)
    }
  }

  // Apply am/pm
  if (isPm && hours < 12) hours += 12
  if (isAm && hours === 12) hours = 0

  // Clamp
  hours = Math.max(0, Math.min(23, hours))
  minutes = Math.max(0, Math.min(59, minutes))

  return { hours, minutes }
}

function formatHHMM(hours, minutes) {
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export default function TimeInput({ value, onChange, className }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const inputRef = useRef(null)

  const handleFocus = () => {
    setEditing(true)
    setDraft(value || '')
  }

  const commit = () => {
    setEditing(false)
    const parsed = parseTimeStr(draft)
    if (parsed) {
      onChange(formatHHMM(parsed.hours, parsed.minutes))
    }
    // If parse fails, revert to previous value
  }

  const handleBlur = () => commit()

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      commit()
      inputRef.current?.blur()
    }
    if (e.key === 'Escape') {
      setEditing(false)
      setDraft(value || '')
      inputRef.current?.blur()
    }
  }

  return (
    <input
      ref={inputRef}
      type="text"
      value={editing ? draft : value}
      onChange={e => setDraft(e.target.value)}
      onFocus={handleFocus}
      onBlur={handleBlur}
      onKeyDown={handleKeyDown}
      placeholder="HH:MM"
      className={className}
    />
  )
}
