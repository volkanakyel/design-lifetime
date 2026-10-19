import { gsap } from 'gsap'
import { CustomEase } from 'gsap/CustomEase'
import {
  clamp, mix, smoothstep, motion, ERAS, INITIAL_VALUE, yearToT, nearestEra,
  detentCount, detentStrength, magneticYear, magneticValue, eachCrossing, criticalStep, springStep,
} from './morph.mjs'
import { TactileEngine } from './tactile'
import { createRenderer } from './renderer'

type Axis = { position: number, velocity: number }
type Snap = { target: number }
type Drag = { kind: 'dial' | 'time', id: number, element: HTMLElement, left: number, width: number, cx: number, cy: number, scale: number, angle: number, lastY: number, lastTime: number, velocity: number, vertical: boolean }

export function createDialController(root: HTMLElement) {
  gsap.registerPlugin(CustomEase)
  CustomEase.create('out', motion.ease.out.join(',')); CustomEase.create('inOut', motion.ease.inOut.join(','))
  gsap.defaults({ ease: 'out', duration: motion.duration.md / 1000, overwrite: 'auto' })
  // This ticker is the only rAF clock. Vue never rerenders on pointer movement.
  gsap.ticker.fps(120)
  const $ = <T extends HTMLElement = HTMLElement>(selector: string) => root.querySelector<T>(selector)!
  const dial = $('.instrument'), timeline = $('.time-control'), anatomy = $('.anatomy')
  const controls = $('[data-controls]'), thumb = $('[data-thumb]'), ring = $('.edge-and-scale')
  const idleLayer = $('[data-idle]'), status = $('[data-status]')
  const ticks = Array.from(root.querySelectorAll<SVGElement>('[data-tick]'))
  const media = matchMedia('(prefers-reduced-motion: reduce)'), abort = new AbortController()
  const audio = new TactileEngine(), render = createRenderer(root, () => media.matches)
  const value: Axis = { position: INITIAL_VALUE, velocity: 0 }, year: Axis = { position: 1974, velocity: 0 }
  const state = { rawValue: INITIAL_VALUE, rawYear: 1974, t: 0, dialGesture: false, yearGesture: false, recording: false, hidden: false, play: 0, direction: 0 }
  let valueSnap: Snap | null = null, yearSnap: Snap | null = null, drag: Drag | null = null
  let followValue = false, listening = false, destroyed = false, idle = false
  let playback: gsap.core.Timeline | null = null, travel: gsap.core.Tween | null = null
  let reducedFade: gsap.core.Timeline | null = null
  let idleTimer: ReturnType<typeof setTimeout>, wheelTimer: ReturnType<typeof setTimeout>
  let paintedT = 0, requestedReducedT = 0, detentCrossings = 0, yearCrossings = 0, frames = 0
  const crossedYears: number[] = []
  const duration = (ms: number) => (media.matches ? Math.min(ms, 150) : ms) / 1000
  const announce = (text: string) => { status.textContent = text }
  const options = { signal: abort.signal }
  function wake() { if (!listening && !document.hidden && !destroyed) { listening = true; gsap.ticker.add(tick) } }
  function sleep() { if (listening) { gsap.ticker.remove(tick); listening = false }; audio.scratchSpeed(0, state.t) }

  function interact() {
    audio.unlock(); clearTimeout(idleTimer)
    if (idle) { idle = false; gsap.to(idleLayer, { opacity: 1, duration: duration(motion.duration.md) }) }
    idleTimer = setTimeout(() => {
      if (drag || state.dialGesture || state.yearGesture || state.recording) { interact(); return }
      idle = true; gsap.to(idleLayer, { opacity: .4, duration: duration(motion.duration.md) }); audio.suspend()
    }, 1200)
  }
  function freezeValue() { state.rawValue = value.position; value.velocity = 0; valueSnap = null; followValue = false; state.dialGesture = false; state.play = 0; clearTimeout(wheelTimer) }
  function freezeYear() { state.rawYear = year.position; year.velocity = 0; yearSnap = null; state.yearGesture = false; travel?.kill(); travel = null }
  function cancelDrag() {
    clearTimeout(wheelTimer)
    if (!drag) return
    const previous = drag; drag = null
    if (previous.element.hasPointerCapture(previous.id)) previous.element.releasePointerCapture(previous.id)
    state.dialGesture = false; state.yearGesture = false
  }

  function setValue(next: number, gesture: boolean) {
    next = clamp(next, 0, 100)
    const direction = Math.sign(next - state.rawValue)
    if (gesture && direction && state.direction && direction !== state.direction && !media.matches) state.play = -direction * .08 * (1 - clamp(state.t))
    if (direction) state.direction = direction
    state.rawValue = next; state.dialGesture = gesture; followValue = gesture; valueSnap = null; wake()
  }
  function releaseValue(velocity = value.velocity) {
    state.dialGesture = false
    const strength = detentStrength(state.t)
    if (!strength) { followValue = true; wake(); return }
    const step = 100 / detentCount(state.t), nearest = clamp(Math.round(state.rawValue / step) * step, 0, 100)
    const target = mix(state.rawValue, nearest, smoothstep(0, .5, strength))
    state.rawValue = target; followValue = false
    valueSnap = { target }
    value.velocity = clamp(velocity, -200, 200)
    if (media.matches) { value.position = target; value.velocity = 0; valueSnap = null }
    wake()
  }
  function setYear(next: number, gesture: boolean) {
    state.rawYear = media.matches ? nearestEra(next) : clamp(next, 1974, 2026)
    state.yearGesture = gesture; yearSnap = null; wake()
  }
  function releaseYear(velocity = year.velocity) {
    state.yearGesture = false
    const nearest = nearestEra(state.rawYear)
    const target = Math.abs(state.rawYear - nearest) <= 1.5 ? nearest : state.rawYear
    state.rawYear = target
    yearSnap = { target }
    year.velocity = clamp(velocity, -60, 60)
    if (media.matches) { year.position = nearestEra(target); state.rawYear = year.position; year.velocity = 0; yearSnap = null }
    wake()
  }

  function dialFeedback(before: number, after: number) {
    if (before === after || !detentStrength(state.t)) return
    eachCrossing(before, after, detentCount(state.t), (index: number, at: number) => {
      detentCrossings++
      if (state.t > 1) {
        const tickIndex = Math.round(at / 100 * 23), element = ticks[tickIndex]!
        gsap.killTweensOf(element); gsap.set(element, { opacity: 1 })
        gsap.to(element, { opacity: 0, duration: duration(motion.duration.md) })
      }
      audio.detentHaptic(state.t)
      const audible = audio.click(at, state.t)
      dial.dispatchEvent(new CustomEvent('dial:detent', { detail: { index, value: at, t: state.t, audible } }))
    })
    // Hardware stays still. Tick light and the short tactile voice carry the feedback.
  }
  function timeFeedback(before: number, after: number) {
    if (before === after) return
    crossedYears.length = 0
    eachCrossing(before, after, 52, (_: number, at: number) => { crossedYears.push(at) }, 1974, 2026)
    if (!crossedYears.length) return
    const milestone = crossedYears.findLast(at => ERAS.includes(at))
    // When one frame crosses several years, reserve the rate-limited voice for an era.
    const selected = milestone ?? crossedYears[crossedYears.length - 1]!
    const audible = audio.click((selected - 1974) / 52 * 100, state.t, milestone === undefined ? 'year' : 'era')
    for (const at of crossedYears) {
      yearCrossings++; const major = ERAS.includes(at)
      timeline.dispatchEvent(new CustomEvent('dial:year', { detail: { year: at, major, audible: audible && at === selected } }))
    }
    audio.yearHaptic(milestone !== undefined)
  }

  function paintMorph(t: number) {
    if (!media.matches) { render.morph(t); paintedT = t; return }
    if (t === requestedReducedT) return
    requestedReducedT = t; reducedFade?.kill()
    // Fade the single anatomy out, change its parameters invisibly, then fade it back.
    reducedFade = gsap.timeline().to(anatomy, { opacity: 0, duration: motion.duration.press / 2000 }).call(() => {
      paintedT = requestedReducedT; render.morph(paintedT, true)
    }).to(anatomy, { opacity: 1, duration: motion.duration.press / 2000 })
  }
  function tick(_: number, deltaMs: number) {
    const dt = Math.min(deltaMs, 32) / 1000, previousValue = value.position, previousYear = year.position
    let needsFollow = false
    if (media.matches) { year.position = nearestEra(state.rawYear); state.rawYear = year.position; year.velocity = 0; yearSnap = null }
    else if (yearSnap) {
      if (springStep(year, yearSnap.target, dt)) yearSnap = null
    } else {
      year.position = state.yearGesture ? magneticYear(state.rawYear) : state.rawYear
      year.velocity = dt ? (year.position - previousYear) / dt : 0
    }
    year.position = clamp(year.position, 1974, 2026); state.t = yearToT(year.position)
    if (media.matches) { value.position = valueSnap ? valueSnap.target : state.rawValue; value.velocity = 0; valueSnap = null; followValue = false; state.play = 0 }
    else if (valueSnap) {
      if (springStep(value, valueSnap.target, dt)) valueSnap = null
    } else if (followValue && state.t < 2) {
      const target = state.dialGesture ? magneticValue(state.rawValue, state.t) : state.rawValue
      const omega = state.t <= 1 ? mix(65, 44, state.t) : 44 / Math.max(.02, 1 - smoothstep(1, 2, state.t))
      criticalStep(value, target, omega, dt)
      needsFollow = Math.abs(value.position - target) >= .001 || Math.abs(value.velocity) >= .02
      if (!state.dialGesture && Math.abs(value.position - target) < .001 && Math.abs(value.velocity) < .02) { value.position = target; value.velocity = 0; followValue = false }
    } else {
      value.position = state.dialGesture ? magneticValue(state.rawValue, state.t) : state.rawValue
      value.velocity = dt ? (value.position - previousValue) / dt : 0
      if (!state.dialGesture) followValue = false
    }
    value.position = clamp(value.position, 0, 100)
    if (state.play) { state.play *= Math.exp(-dt * 48); if (Math.abs(state.play) < .001) state.play = 0 }
    // Audio, haptics, and tick opacity are dispatched together, before this frame paints.
    dialFeedback(previousValue, value.position); timeFeedback(previousYear, year.position)
    paintMorph(state.t); render.value(value.position, state.play); render.year(year.position)
    audio.scratchSpeed(dt ? (value.position - previousValue) / dt : 0, state.t)
    frames++
    // A held pointer needs no frames once it stops moving. Input handlers wake this
    // clock on the next sample; spring following and recording keep it alive as needed.
    if (!state.recording && !needsFollow && !valueSnap && !yearSnap && !state.play && !travel?.isActive()) sleep()
  }

  function stopRecording() {
    if (!playback) return
    playback.kill(); playback = null; state.recording = false
    freezeValue(); freezeYear(); interact(); wake(); announce('Recording sequence stopped.')
  }
  function jumpYear(target: number, animate = false) {
    stopRecording(); cancelDrag(); freezeValue(); freezeYear(); interact()
    if (!animate || media.matches) { setYear(target, false); return }
    travel = gsap.to(state, { rawYear: target, duration: motion.duration.lg / 1000, ease: 'inOut', onComplete: () => { travel = null; wake() } }); wake()
  }
  function startRecording() {
    stopRecording(); cancelDrag(); freezeValue(); freezeYear(); interact()
    state.rawValue = INITIAL_VALUE; value.position = INITIAL_VALUE; value.velocity = 0; state.rawYear = 1974; year.position = 1974; year.velocity = 0
    state.play = 0; state.direction = 0; state.t = 0; state.recording = true
    reducedFade?.kill(); gsap.set(anatomy, { opacity: 1 }); paintedT = requestedReducedT = 0
    render.morph(0, true); render.value(INITIAL_VALUE, 0, true); render.year(1974, true)
    const sequence = gsap.timeline({ repeat: -1, onRepeat: () => {
      state.rawYear = year.position = 1974; state.rawValue = value.position = INITIAL_VALUE
      state.t = 0; value.velocity = year.velocity = 0; state.play = 0; valueSnap = yearSnap = null
    } })
    playback = sequence
    function turn(at: number, to: number, length: number, snap = true, ease = 'out') {
      sequence.call(() => { freezeYear(); state.dialGesture = true; followValue = true; valueSnap = null; interact(); audio.contact(state.t); wake() }, [], at)
      sequence.to(state, { rawValue: to, duration: length, ease, overwrite: false }, at)
      sequence.call(() => { if (snap) releaseValue(); else { state.dialGesture = false; followValue = state.t < 2 } }, [], at + length)
    }
    function scrub(at: number, to: number, length: number, snap = false) {
      sequence.call(() => { freezeValue(); state.yearGesture = true; yearSnap = null; interact(); wake() }, [], at)
      sequence.to(state, { rawYear: to, duration: length, ease: 'inOut', overwrite: false }, at)
      sequence.call(() => { if (snap) releaseYear(); else { state.yearGesture = false; state.rawYear = to } }, [], at + length)
    }
    turn(.35, 55, .9, false, 'inOut')
    scrub(1.55, 1990, 1.45); scrub(3.28, 2010.2, 1.72, true)
    turn(5.55, 35, 1, true, 'inOut')
    scrub(6.9, 2025.4, 1.45, true)
    ;[8.95, 9.4, 9.83, 10.32, 10.74, 11.22, 11.65, 12.1].forEach((at, i) => turn(at, (9 + i) * 100 / 23, i % 3 ? .18 : .24))
    turn(12.8, 99.3, .24)
    turn(13.75, INITIAL_VALUE, 1.1, false, 'inOut')
    scrub(15.2, 1974, 1.7)
    sequence.call(() => {}, [], 17.6)
    wake(); announce('Recording sequence playing. Press R or Escape to stop.')
  }

  function begin(event: PointerEvent, kind: 'dial' | 'time') {
    if (event.button !== 0 || drag) return
    const element = kind === 'dial' ? dial : timeline
    // Cache all geometry before writes. Neither pointermove nor the ticker reads layout.
    const bounds = element.getBoundingClientRect()
    stopRecording(); travel?.kill(); travel = null; clearTimeout(wheelTimer)
    if (kind === 'dial') freezeYear(); else freezeValue()
    interact(); element.focus({ preventScroll: true })
    if (kind === 'dial') audio.contact(state.t)
    const cx = bounds.left + bounds.width / 2, cy = bounds.top + bounds.height / 2
    drag = { kind, element, id: event.pointerId, left: bounds.left, width: bounds.width, cx, cy, scale: bounds.width / 640,
      angle: Math.atan2(event.clientX - cx, -(event.clientY - cy)) * 180 / Math.PI,
      lastY: event.clientY, lastTime: event.timeStamp, velocity: 0,
      vertical: event.altKey || Math.hypot(event.clientX - cx, event.clientY - cy) < bounds.width * .18 }
    element.setPointerCapture(event.pointerId)
    if (kind === 'time') setYear(1974 + clamp((event.clientX - bounds.left) / bounds.width) * 52, true)
    else { state.rawValue = value.position; state.dialGesture = true; followValue = true; valueSnap = null }
    wake(); event.preventDefault()
  }
  function move(event: PointerEvent) {
    if (!drag || event.pointerId !== drag.id) return
    const coalesced = event.getCoalescedEvents?.()
    for (const point of coalesced?.length ? coalesced : [event]) {
      const before = drag.kind === 'time' ? state.rawYear : state.rawValue
      if (drag.kind === 'time') setYear(1974 + clamp((point.clientX - drag.left) / drag.width) * 52, true)
      else if (drag.vertical) setValue(state.rawValue + (drag.lastY - point.clientY) / (drag.scale * 3.8), true)
      else {
        const x = point.clientX - drag.cx, y = point.clientY - drag.cy
        if (Math.hypot(x, y) > 24 * drag.scale) {
          const angle = Math.atan2(x, -y) * 180 / Math.PI, delta = ((angle - drag.angle + 540) % 360) - 180
          setValue(state.rawValue + delta / 2.7, true); drag.angle = angle
        }
      }
      const now = drag.kind === 'time' ? state.rawYear : state.rawValue, dt = point.timeStamp - drag.lastTime
      if (dt > 0) drag.velocity = drag.velocity * .55 + (now - before) / dt * 1000 * .45
      drag.lastTime = point.timeStamp; drag.lastY = point.clientY
    }
  }
  function end(event: PointerEvent, cancelled = false) {
    if (!drag || event.pointerId !== drag.id) return
    const kind = drag.kind, velocity = !cancelled && event.timeStamp - drag.lastTime < 90 ? drag.velocity : 0
    cancelDrag(); if (kind === 'time') releaseYear(velocity); else releaseValue(velocity)
    interact()
  }
  dial.addEventListener('pointerdown', event => begin(event, 'dial'), options)
  timeline.addEventListener('pointerdown', event => begin(event, 'time'), options)
  for (const element of [dial, timeline]) {
    element.addEventListener('pointermove', move, options)
    element.addEventListener('pointerup', event => end(event), options)
    element.addEventListener('pointercancel', event => end(event, true), options)
    element.addEventListener('lostpointercapture', event => end(event, true), options)
  }
  dial.addEventListener('wheel', event => {
    event.preventDefault(); stopRecording(); freezeYear(); interact()
    const units = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 400 : 1
    if (!state.dialGesture) audio.contact(state.t)
    setValue(state.rawValue - event.deltaY * units * .035, true)
    clearTimeout(wheelTimer); wheelTimer = setTimeout(() => { releaseValue(0); interact() }, motion.duration.smExit)
  }, { ...options, passive: false })
  dial.addEventListener('keydown', event => {
    const direction = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 } as Record<string, number>)[event.key]
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault(); stopRecording(); cancelDrag(); freezeYear(); interact()
    audio.contact(state.t)
    setValue(event.key === 'Home' ? 0 : event.key === 'End' ? 100 : Math.round(state.rawValue) + direction! * (event.shiftKey ? 10 : 1), false)
    value.velocity = 0
  }, options)
  timeline.addEventListener('keydown', event => {
    const direction = ({ ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1 } as Record<string, number>)[event.key]
    if (!direction && event.key !== 'Home' && event.key !== 'End') return
    event.preventDefault()
    let target = event.key === 'Home' ? 1974 : event.key === 'End' ? 2026 : clamp(Math.round(year.position) + direction!, 1974, 2026)
    if (direction && (event.shiftKey || media.matches)) target = direction > 0 ? ERAS.find(era => era > year.position + .001) ?? 2026 : [...ERAS].reverse().find(era => era < year.position - .001) ?? 1974
    jumpYear(target, event.shiftKey)
  }, options)
  document.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey || event.repeat) return
    const key = event.key.toLowerCase()
    if (/^[123]$/.test(key)) { event.preventDefault(); jumpYear(ERAS[Number(key) - 1]!, true) }
    if (key === 'r') { event.preventDefault(); state.recording ? stopRecording() : startRecording() }
    if (key === 'escape') { stopRecording(); cancelDrag(); freezeValue(); freezeYear(); wake() }
    if (key === 'h') {
      state.hidden = !state.hidden; root.classList.toggle('capture-hidden', state.hidden); controls.inert = state.hidden
      gsap.to(controls, { opacity: state.hidden ? 0 : 1, duration: duration(state.hidden ? motion.duration.mdExit : motion.duration.md) })
      if (state.hidden && controls.contains(document.activeElement)) dial.focus({ preventScroll: true })
      announce(state.hidden ? 'Timeline hidden. Press H to show.' : 'Timeline visible.')
    }
    if (key === 'm') { announce(audio.toggle() ? 'Sound off.' : 'Sound on.'); interact() }
  }, options)
  document.addEventListener('pointerdown', () => audio.unlock(), { ...options, once: true, passive: true })
  document.addEventListener('keydown', () => audio.unlock(), { ...options, once: true })
  document.addEventListener('touchstart', () => {}, { ...options, passive: true })
  window.addEventListener('resize', () => {
    if (drag) { const kind = drag.kind; cancelDrag(); if (kind === 'time') releaseYear(0); else releaseValue(0) }
  }, { ...options, passive: true })
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearTimeout(idleTimer)
      if (state.recording) playback?.pause()
      else { cancelDrag(); freezeValue(); freezeYear() }
      sleep(); audio.suspend()
    }
    else { interact(); playback?.resume(); if (state.recording) wake() }
  }, options)
  media.addEventListener('change', () => {
    cancelDrag(); reducedFade?.kill()
    gsap.set([ring, thumb], { scale: 1 }); gsap.set(anatomy, { opacity: 1 })
    freezeValue(); freezeYear()
    if (media.matches) { year.position = state.rawYear = nearestEra(year.position); state.t = yearToT(year.position); state.play = 0 }
    paintedT = requestedReducedT = state.t; render.morph(state.t, true); render.digits(value.position, true); render.yearDigits(year.position, true); wake()
  }, options)

  // Useful to capture tools and browser tests; no DOM geometry or mutable engine state leaks.
  const capture = Object.freeze({
    get state() { return { t: state.t, paintedT, year: year.position, value: value.position, rawValue: state.rawValue, recording: state.recording, reducedMotion: media.matches, tickerActive: listening, detentCrossings, yearCrossings, clicks: audio.clicks, frames } },
    start: startRecording, stop: stopRecording,
    year: (next: number) => { if (Number.isFinite(next)) jumpYear(clamp(next, 1974, 2026)) },
    value: (next: number) => { if (Number.isFinite(next)) { stopRecording(); cancelDrag(); freezeYear(); interact(); setValue(next, false) } },
  })
  ;(window as unknown as { dial: typeof capture }).dial = capture
  gsap.set(ring, { scale: 1 }); gsap.set(thumb, { x: 0, y: 0, xPercent: -50, yPercent: -50, scale: 1 }); gsap.set(ticks, { opacity: 0 })
  render.morph(0, true); render.value(INITIAL_VALUE, 0, true); render.year(1974, true)
  idleTimer = setTimeout(() => { idle = true; gsap.to(idleLayer, { opacity: .4, duration: duration(motion.duration.md) }) }, 1200)
  return () => {
    destroyed = true; cancelDrag(); sleep(); abort.abort(); clearTimeout(idleTimer); clearTimeout(wheelTimer)
    playback?.kill(); travel?.kill(); reducedFade?.kill()
    gsap.killTweensOf(root.querySelectorAll('*')); gsap.killTweensOf(state); audio.dispose()
    const host = window as unknown as { dial?: typeof capture }; if (host.dial === capture) delete host.dial
  }
}
