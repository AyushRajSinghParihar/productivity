let audioCtx = null

function getContext() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)()
  }
  return audioCtx
}

function beep(ctx, startTime, frequency, duration) {
  const osc = ctx.createOscillator()
  const gain = ctx.createGain()
  osc.connect(gain)
  gain.connect(ctx.destination)
  osc.frequency.value = frequency
  osc.type = 'sine'
  gain.gain.setValueAtTime(0.3, startTime)
  gain.gain.exponentialRampToValueAtTime(0.01, startTime + duration)
  osc.start(startTime)
  osc.stop(startTime + duration)
}

export function playNotificationSound() {
  try {
    const ctx = getContext()
    const now = ctx.currentTime
    beep(ctx, now, 660, 0.15)
    beep(ctx, now + 0.2, 880, 0.15)
    beep(ctx, now + 0.4, 660, 0.3)
  } catch {
    // Web Audio API not available
  }
}
