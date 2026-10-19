/** Short mechanical voices, rendered once at the device sample rate. */
export const SOUND = Object.freeze({
  plastic: { seconds: .010, frequency: 1180, q: .68, gain: .026, seed: 2011 },
  ceramic: { seconds: .0035, frequency: 3200, q: 1.15, gain: .032, seed: 2026 },
  year: { seconds: .012, frequency: 4400, q: .9, gain: .012, seed: 52 },
  era: { seconds: .024, frequency: 1750, q: .8, gain: .026, seed: 3 },
})

function envelope(time, length, attack) {
  if (time <= 0 || time >= length) return 0
  const onset = time < attack ? .5 - .5 * Math.cos(Math.PI * time / attack) : 1
  const tail = Math.min(1, (length - time) / .0004)
  return onset * Math.exp(-7 * Math.max(0, time - attack) / (length - attack)) * tail
}

export function buildSound(kind, sampleRate) {
  const profile = SOUND[kind], samples = new Float32Array(Math.round(profile.seconds * sampleRate))
  const omega = 2 * Math.PI * profile.frequency / sampleRate, alpha = Math.sin(omega) / (2 * profile.q)
  const b0 = alpha / (1 + alpha), a1 = -2 * Math.cos(omega) / (1 + alpha), a2 = (1 - alpha) / (1 + alpha)
  let seed = profile.seed, x1 = 0, x2 = 0, y1 = 0, y2 = 0, peak = 0
  for (let i = 0; i < samples.length; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) | 0
    const x = seed / 2147483648, y = b0 * (x - x2) - a1 * y1 - a2 * y2, time = i / sampleRate
    x2 = x1; x1 = x; y2 = y1; y1 = y
    let value
    if (kind === 'plastic') {
      value = (y + .2 * Math.sin(2 * Math.PI * 310 * time)) * envelope(time, profile.seconds, .00065)
    } else if (kind === 'ceramic') {
      value = y * envelope(time, profile.seconds, .0002)
    } else if (kind === 'year') {
      // A light, two-part read-head tick, separate from either dial material.
      const first = envelope(time, .004, .00025), second = envelope(time - .005, .007, .00025)
      value = (y + .12 * Math.sin(2 * Math.PI * 2200 * time)) * (first + .55 * second)
    } else {
      // Era arrival: a lower, fuller latch, followed by a quieter seating click.
      const first = envelope(time, .009, .00045), second = envelope(time - .011, .013, .00045)
      value = (y + .18 * Math.sin(2 * Math.PI * 620 * time)) * (first + .65 * second)
    }
    samples[i] = value; peak = Math.max(peak, Math.abs(value))
  }
  if (peak) for (let i = 0; i < samples.length; i++) samples[i] *= .8 / peak
  samples[samples.length - 1] = 0
  return samples
}
