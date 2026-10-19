import { clamp, mix, smoothstep } from './morph.mjs'
import { buildSound, SOUND } from './sound.mjs'

type VoiceKind = 'dial' | 'year' | 'era'
type SampleKind = keyof typeof SOUND
type Voice = { buffer: AudioBuffer, gain: GainNode }
const YEAR_HAPTIC = [1, 6, 1] as const
const ERA_HAPTIC = [4, 8, 2] as const

/** Pre-rendered voices share a persistent graph; each click allocates only its one-shot source. */
export class TactileEngine {
  muted = false
  clicks = 0
  private audio: { ctx: AudioContext, master: GainNode, scratch: GainNode, frictionFilter: BiquadFilterNode, source: AudioBufferSourceNode, voices: Record<SampleKind, Voice> } | null = null
  private lastClick = -Infinity
  private lastVibration = -Infinity
  private vibrationPriority = 0
  private scratchAmplitude = 0
  private scratchFrequency = 650

  unlock() {
    if (this.muted) return
    try {
      if (!this.audio) {
        const Audio = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (!Audio) return
        const ctx = new Audio({ latencyHint: 'interactive' })
        const noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate)
        const data = noise.getChannelData(0)
        let seed = 1974
        for (let i = 0; i < data.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; data[i] = seed / 2147483648 }
        const master = ctx.createGain(); master.gain.value = .34; master.connect(ctx.destination)
        const source = ctx.createBufferSource(); source.buffer = noise; source.loop = true
        const low = ctx.createBiquadFilter(); low.type = 'lowpass'; low.frequency.value = 650; low.Q.value = .55
        const high = ctx.createBiquadFilter(); high.type = 'highpass'; high.frequency.value = 110; high.Q.value = .55
        const scratch = ctx.createGain(); scratch.gain.value = 0
        source.connect(low).connect(high).connect(scratch).connect(master); source.start()
        const voices = {} as Record<SampleKind, Voice>
        for (const kind of Object.keys(SOUND) as SampleKind[]) {
          const samples = buildSound(kind, ctx.sampleRate)
          const buffer = ctx.createBuffer(1, samples.length, ctx.sampleRate)
          buffer.getChannelData(0).set(samples)
          const gain = ctx.createGain(); gain.gain.value = 0; gain.connect(master)
          voices[kind] = { buffer, gain }
        }
        this.audio = { ctx, master, scratch, frictionFilter: low, source, voices }
      }
      if (this.audio.ctx.state === 'suspended') void this.audio.ctx.resume().catch(() => {})
    } catch { /* Unsupported or policy-blocked audio never blocks an interaction. */ }
  }

  private play(kind: SampleKind, amplitude: number, pitch = 1) {
    if (!this.audio || amplitude < .0001) return
    const { ctx, voices } = this.audio, voice = voices[kind], now = ctx.currentTime
    // All samples finish within 24 ms, before the next rate-limited voice can begin.
    voice.gain.gain.setValueAtTime(amplitude, now)
    const src = ctx.createBufferSource(); src.buffer = voice.buffer; src.playbackRate.value = pitch
    src.connect(voice.gain)
    src.start(now, 0, voice.buffer.duration); src.stop(now + voice.buffer.duration / pitch)
    src.onended = () => src.disconnect()
  }

  click(value: number, t: number, kind: VoiceKind = 'dial') {
    if (!this.audio || this.muted || this.audio.ctx.state !== 'running') return false
    const { ctx } = this.audio, now = ctx.currentTime
    const crisp = clamp(t - 1), analog = smoothstep(.12, 1, t)
    if (kind === 'dial' && analog < .03) return false
    // One cap covers both controls. No stale clicks are queued after visible feedback.
    if (now - this.lastClick < .04 - 1e-9) return false
    this.lastClick = now; this.clicks++
    if (kind === 'dial') {
      this.play('plastic', SOUND.plastic.gain * analog * (1 - crisp), 1 + .015 * value / 100)
      this.play('ceramic', SOUND.ceramic.gain * crisp, 1 + .03 * value / 100)
    } else this.play(kind, SOUND[kind].gain)
    return true
  }

  scratchSpeed(speed: number, t: number) {
    if (!this.audio || this.audio.ctx.state !== 'running') return
    const movement = Math.abs(speed) / (Math.abs(speed) + 75)
    const amplitude = this.muted ? 0 : .012 * movement * (1 - smoothstep(.15, .95, t))
    const now = this.audio.ctx.currentTime
    // Skip inaudible changes instead of adding two automation events every frame.
    if (Math.abs(amplitude - this.scratchAmplitude) > .00004 || (amplitude === 0 && this.scratchAmplitude !== 0)) {
      this.audio.scratch.gain.setTargetAtTime(amplitude, now, speed ? .028 : .045)
      this.scratchAmplitude = amplitude
    }
    const frequency = 650 + 250 * movement
    if (amplitude > 0 && Math.abs(frequency - this.scratchFrequency) > 2) {
      this.audio.frictionFilter.frequency.setTargetAtTime(frequency, now, .04)
      this.scratchFrequency = frequency
    }
  }

  contact(t: number) { if (t < .5) this.vibrate(2) }
  detentHaptic(t: number) { this.vibrate(Math.round(mix(5, 3, clamp(t - 1))), 1) }
  yearHaptic(major: boolean) { this.vibrate(major ? ERA_HAPTIC : YEAR_HAPTIC, major ? 2 : 0) }

  private vibrate(pattern: number | readonly number[], priority = 0) {
    if (typeof navigator.vibrate !== 'function') return
    const now = performance.now() / 1000
    // Avoid repeatedly cancelling a pulse during fast crossings. Era latches may preempt light ticks.
    if (now - this.lastVibration < .04 - 1e-9 && priority <= this.vibrationPriority) return
    this.lastVibration = now; this.vibrationPriority = priority
    try { navigator.vibrate(typeof pattern === 'number' ? pattern : [...pattern]) } catch {}
  }

  toggle() {
    this.muted = !this.muted
    if (!this.muted) this.unlock()
    if (this.audio) this.audio.master.gain.setTargetAtTime(this.muted ? 0 : .34, this.audio.ctx.currentTime, .015)
    return this.muted
  }

  suspend() { if (this.audio) void this.audio.ctx.suspend().catch(() => {}) }
  dispose() { if (this.audio) { this.audio.source.stop(); void this.audio.ctx.close().catch(() => {}); this.audio = null } }
}
