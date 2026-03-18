'use client'
import { useState, useEffect, useCallback } from 'react'
import { getSettings, saveSettings } from '../lib/settings'
import ConfirmDialog from './ConfirmDialog'

const ALL_KEYS = [
  'focusboard-tasks',
  'focusboard-session',
  'focusboard-skip-offset',
  'focusboard-settings',
  'focusboard-history',
  'focusboard-planned-start',
  'focusboard-paused-at',
  'focusboard-manual-break',
]

export default function SettingsPanel({ isOpen, onClose }) {
  const [settings, setSettings] = useState(null)
  const [confirmNuke, setConfirmNuke] = useState(false)

  useEffect(() => {
    if (isOpen) setSettings(getSettings())
  }, [isOpen])

  const update = useCallback((partial) => {
    setSettings(prev => {
      const next = { ...prev, ...partial }
      saveSettings(next)
      if (partial.theme) {
        document.documentElement.setAttribute('data-theme', partial.theme)
      }
      return next
    })
  }, [])

  useEffect(() => {
    if (!isOpen) return
    const handler = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [isOpen, onClose])

  if (!isOpen || !settings) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-[var(--bg-secondary)] border border-[var(--border)] rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl max-h-[80vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-[var(--text)] text-xl font-bold">Settings</h2>
          <button
            onClick={onClose}
            className="text-[var(--text-muted)] hover:text-[var(--text)] text-2xl leading-none transition-colors"
          >
            &times;
          </button>
        </div>

        <div className="space-y-6">
          {/* Theme */}
          <SettingRow label="Theme">
            <select
              value={settings.theme}
              onChange={e => update({ theme: e.target.value })}
              className="bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-1.5 text-sm outline-none focus:border-[var(--text-muted)]"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
            </select>
          </SettingRow>

          {/* Breaks */}
          <div>
            <SettingRow label="Break between tasks">
              <Toggle checked={settings.breaksEnabled} onChange={v => update({ breaksEnabled: v })} />
            </SettingRow>
            {settings.breaksEnabled && (
              <div className="mt-2 ml-1 flex items-center gap-2">
                <input
                  type="number"
                  value={settings.breakDuration}
                  onChange={e => update({ breakDuration: Math.max(1, Math.min(60, Number(e.target.value))) })}
                  className="w-16 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-1.5 text-sm text-center outline-none focus:border-[var(--text-muted)]"
                  min="1"
                  max="60"
                />
                <span className="text-[var(--text-muted)] text-sm">min</span>
              </div>
            )}
          </div>

          {/* Day Rollover */}
          <div>
            <SettingRow label="Day rolls over at">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  value={settings.dayRolloverHour}
                  onChange={e => update({ dayRolloverHour: Math.max(0, Math.min(23, Number(e.target.value))) })}
                  className="w-16 bg-[var(--bg)] border border-[var(--border)] text-[var(--text)] rounded-lg px-3 py-1.5 text-sm text-center outline-none focus:border-[var(--text-muted)]"
                  min="0"
                  max="23"
                />
                <span className="text-[var(--text-muted)] text-sm">:00</span>
              </div>
            </SettingRow>
            <p className="text-[var(--text-muted)] text-xs mt-1 ml-1">
              Working at 2 AM still counts as the previous day if rollover is set to 4:00
            </p>
          </div>

          {/* Notifications */}
          <SettingRow label="Notification sound">
            <Toggle checked={settings.notificationSound} onChange={v => update({ notificationSound: v })} />
          </SettingRow>

          <SettingRow label="Screen flash on task end">
            <Toggle checked={settings.notificationFlash} onChange={v => update({ notificationFlash: v })} />
          </SettingRow>

          {/* Danger Zone */}
          <div className="pt-4 mt-2 border-t border-[var(--border)]">
            <p className="text-[var(--text-muted)] text-xs uppercase tracking-widest mb-3">Danger Zone</p>
            <button
              onClick={() => setConfirmNuke(true)}
              className="w-full text-left text-sm text-[var(--danger)] hover:text-[var(--danger-hover)] transition-colors py-2 px-3 rounded-lg hover:bg-[var(--bg-hover)]"
            >
              Reset all data &mdash; clear tasks, sessions, history &amp; settings
            </button>
          </div>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmNuke}
        message="This will permanently delete all tasks, sessions, history, and settings. Are you sure?"
        onConfirm={() => {
          ALL_KEYS.forEach(k => localStorage.removeItem(k))
          document.documentElement.setAttribute('data-theme', 'dark')
          setConfirmNuke(false)
          onClose()
          window.location.reload()
        }}
        onCancel={() => setConfirmNuke(false)}
      />
    </div>
  )
}

function SettingRow({ label, children }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-[var(--text)] text-sm">{label}</span>
      {children}
    </div>
  )
}

function Toggle({ checked, onChange }) {
  return (
    <button
      onClick={() => onChange(!checked)}
      className={`relative w-10 h-5 rounded-full transition-colors ${checked ? 'bg-yellow-500' : 'bg-[var(--border)]'}`}
    >
      <span
        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`}
      />
    </button>
  )
}
