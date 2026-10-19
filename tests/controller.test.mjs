import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { buildSound, SOUND } from '../app/lib/sound.mjs'

const require = createRequire(import.meta.url)
const { gsap } = require('gsap/dist/gsap.js')
const { CustomEase } = require('gsap/dist/CustomEase.js')
CustomEase.register(gsap)

// Executes the actual controller, renderer, digit animations, and WebAudio engine.
// The DOM/audio adapter makes input and GSAP time deterministic; it does not measure browser paint.
function harness({ audio = true, vibration = 'supported' } = {}) {
  gsap.globalTimeline.clear(); gsap.globalTimeline.totalTime(0); gsap.ticker.sleep()
  let time = 0, timerId = 0, layoutReads = 0
  const work = { styles: 0, attributes: 0, text: 0, audioNodes: 0, tweens: 0 }
  const timers = new Map(), ticks = new Set(), voices = [], haptics = [], nodes = new Map(), gains = [], filters = [], audioContexts = []
  const subscriptions = new Set()
  class Element {
    constructor(name) {
      this.name = name; this.style = new Proxy({}, { set(target, key, value) { work.styles++; target[key] = value; return true } }); this.dataset = {}; this.children = []; this.attrs = {}; this.events = {}
      this.textContent = ''; this.opacity = 1; this.scale = 1; this.x = 0; this.y = 0; this.xPercent = 0; this.yPercent = 0
      this.classList = { toggle() {} }
    }
    addEventListener(type, callback, options = {}) {
      if (options.signal?.aborted) return
      const subscription = { type, callback, target: this, once: !!options.once }
      ;(this.events[type] ??= []).push(subscription); subscriptions.add(subscription)
      // Share one abort listener across the fake DOM, just as browsers manage event targets.
      if (options.signal && !subscriptions.signal) {
        subscriptions.signal = options.signal
        options.signal.addEventListener('abort', () => {
          for (const item of subscriptions) item.target.events[item.type] = []
          subscriptions.clear()
        }, { once: true })
      }
    }
    dispatchEvent(event) {
      for (const subscription of [...(this.events[event.type] ?? [])]) {
        subscription.callback(event)
        if (subscription.once) {
          subscriptions.delete(subscription)
          this.events[event.type] = this.events[event.type].filter(item => item !== subscription)
        }
      }
      return true
    }
    set textContent(value) { work.text++; this.text = value }
    get textContent() { return this.text }
    setAttribute(key, value) { work.attributes++; this.attrs[key] = value }
    getAttribute(key) { return this.attrs[key] }
    focus() { document.activeElement = this }
    contains(node) { return node === this }
    getBoundingClientRect() {
      layoutReads++
      return this.name === '.time-control' ? { left: 216, top: 1020, width: 648, height: 112 } : { left: 220, top: 290, width: 640, height: 640 }
    }
    setPointerCapture(id) { this.capture = id }
    hasPointerCapture(id) { return this.capture === id }
    releasePointerCapture() { this.capture = null }
    querySelector(selector) { return element(selector) }
    querySelectorAll(selector) { return groups.get(selector) ?? [] }
  }
  const element = selector => {
    if (!nodes.has(selector)) nodes.set(selector, new Element(selector))
    return nodes.get(selector)
  }
  const groups = new Map()
  for (const [selector, count] of [['[data-printed]', 51], ['[data-led-scale]', 21], ['[data-tick-scale]', 24], ['[data-led]', 21], ['[data-tick]', 24], ['[data-year-tick]', 53]]) {
    groups.set(selector, Array.from({ length: count }, (_, i) => element(`${selector}:${i}`)))
  }
  for (const [selector, text] of [['[data-value-digits]', ' 30'], ['[data-year-digits]', '1974']]) {
    const slots = [...text].map((char, i) => {
      const slot = element(`${selector}:slot${i}`)
      slot.children = Array.from({ length: 3 }, (_, j) => element(`${selector}:slot${i}:glyph${j}`))
      slot.children[0].textContent = char.trim()
      return slot
    })
    element(selector).querySelectorAll = () => slots
  }
  const document = new Element('document'), window = new Element('window'), media = new Element('media')
  document.hidden = false; media.matches = false
  class AudioContext {
    constructor() { this.sampleRate = 48000; this.state = 'running'; this.destination = {}; audioContexts.push(this) }
    get currentTime() { return time }
    createBuffer(_, count) { const data = new Float32Array(count); return { duration: count / this.sampleRate, getChannelData: () => data } }
    node() { work.audioNodes++; return { connect(next) { this.connected = next; return next }, disconnect() {} } }
    param() {
      const events = []
      return { value: 0, events,
        setValueAtTime(value, at) { events.push({ kind: 'set', value, at }) },
        linearRampToValueAtTime(value, at) { events.push({ kind: 'attack', value, at }) },
        exponentialRampToValueAtTime(value, at) { events.push({ kind: 'decay', value, at }) },
        setTargetAtTime(value, at, constant) { events.push({ kind: 'target', value, at, constant }) },
      }
    }
    createGain() { const node = { ...this.node(), gain: this.param() }; gains.push(node); return node }
    createBiquadFilter() { const node = { ...this.node(), frequency: this.param(), Q: this.param() }; filters.push(node); return node }
    createBufferSource() {
      return { ...this.node(), playbackRate: this.param(), start(at, offset, length) {
        if (length) voices.push({ at, length, pitch: this.playbackRate.value, samples: this.buffer.getChannelData(0), gain: this.connected.gain.events.at(-1).value })
      }, stop() {} }
    }
    resume() { this.state = 'running'; return Promise.resolve() }
    suspend() { this.state = 'suspended'; return Promise.resolve() }
    close() { this.state = 'closed'; return Promise.resolve() }
  }
  if (audio) window.AudioContext = AudioContext
  const proxy = Object.create(gsap)
  for (const method of ['to', 'fromTo']) proxy[method] = (...args) => { work.tweens++; return gsap[method](...args) }
  proxy.ticker = { fps() {}, add(fn) { ticks.add(fn) }, remove(fn) { ticks.delete(fn) } }
  const navigator = vibration === 'unsupported' ? {} : { vibrate: ms => {
    if (vibration === 'blocked') throw new Error('Vibration blocked')
    haptics.push({ ms, at: time })
  } }
  const context = vm.createContext({
    console, document, window, AbortController, performance: { now: () => time * 1000 }, navigator, matchMedia: () => media,
    CustomEvent: class { constructor(type, options) { this.type = type; Object.assign(this, options) } },
    setTimeout(fn, ms) { timers.set(++timerId, { at: time + ms / 1000, fn }); return timerId }, clearTimeout: id => timers.delete(id),
  })
  const modules = new Map()
  function load(file) {
    if (modules.has(file)) return modules.get(file)
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
    const module = { exports: {} }; modules.set(file, module.exports)
    const localRequire = id => {
      if (id === 'gsap') return { gsap: proxy }
      if (id === 'gsap/CustomEase') return { CustomEase }
      const resolved = path.resolve(path.dirname(file), id)
      return id.endsWith('.mjs') ? require(resolved) : load(`${resolved}.ts`)
    }
    vm.runInContext(`(function(require,module,exports){${output}\n})`, context, { filename: file })(localRequire, module, module.exports)
    return module.exports
  }
  const root = element('root')
  root.querySelectorAll = selector => selector === '*' ? [...nodes.values()] : groups.get(selector) ?? []
  const dispose = load(path.resolve('app/lib/controller.ts')).createDialController(root)
  function advance(ms, hz = 120) {
    const end = time + ms / 1000
    while (time < end - 1e-8) {
      const dt = Math.min(1 / hz, end - time); time += dt
      gsap.globalTimeline.totalTime(time, false)
      for (const tick of [...ticks]) tick(time, dt * 1000)
      for (const [id, timer] of timers) if (timer.at <= time) { timers.delete(id); timer.fn() }
      gsap.ticker.sleep()
    }
  }
  function event(target, type, detail = {}) {
    target.dispatchEvent({ type, timeStamp: time * 1000, button: 0, pointerId: 1, preventDefault() {}, ...detail })
  }
  function key(key, target = element('.instrument'), shiftKey = false) { event(target, 'keydown', { key, shiftKey }); advance(17) }
  return { api: window.dial, element, advance, event, key, document, window, media, voices, haptics, gains, filters, audioContexts,
    work,
    dispose,
    get resourceCounts() { return { timers: timers.size, ticks: ticks.size, listeners: subscriptions.size } },
    get layoutReads() { return layoutReads },
    close() { dispose(); gsap.globalTimeline.clear(); gsap.ticker.sleep() },
  }
}

test('controller keeps one value through the timeline; input, crossings, and accessibility remain coherent', () => {
  const h = harness()
  try {
    const dial = h.element('.instrument'), timeline = h.element('.time-control'), events = [], years = []
    dial.addEventListener('dial:detent', event => events.push(event.detail))
    timeline.addEventListener('dial:year', event => years.push(event.detail))
    h.api.value(49); h.advance(20)
    for (const year of [1990, 2000, 2011, 2016.55, 2026, 1974]) {
      h.api.year(year); h.advance(30)
      assert.equal(h.api.state.value, 49, `year ${year} moved value`)
    }
    h.api.year(2026); h.advance(20); h.key('Home'); events.length = 0
    h.key('End'); assert.equal(events.length, 23)
    assert.deepEqual(events.map(event => event.index), Array.from({ length: 23 }, (_, i) => i + 1))
    events.length = 0; h.key('Home'); assert.equal(events.length, 23)
    h.key('ArrowRight'); h.key('ArrowRight', dial, true); assert.equal(h.api.state.value, 11)
    assert.equal(dial.getAttribute('aria-valuenow'), '11')
    assert.ok(dial.getAttribute('aria-valuetext').startsWith('11,'))
    h.api.value(49); h.advance(200); h.key('ArrowRight'); h.advance(200)
    const slots = h.element('[data-value-digits]').querySelectorAll('.digit-slot')
    assert.equal(slots[1].children[0].textContent, '5'); assert.equal(slots[2].children[0].textContent, '0')
    const previousTens = slots[1].children[1].textContent
    h.key('ArrowRight'); assert.equal(slots[1].children[1].textContent, previousTens)
    assert.ok(years.some(event => event.year === 2011 && event.major))
    h.api.year(2000); h.advance(20); h.key('ArrowRight', timeline); assert.equal(h.api.state.year, 2001)
    h.key('ArrowRight', timeline, true); h.advance(340); assert.equal(h.api.state.year, 2011)
    assert.equal(timeline.getAttribute('aria-valuetext'), '2011, brushed metal')
  } finally { h.close() }
})

test('recording work budget', () => {
  const h = harness()
  try {
    h.api.start(); h.advance(17600, 120)
    if (process.env.DIAL_PROFILE) console.log('recording work:', JSON.stringify(h.work))
    // Before caching: 154,621 style writes, 9,854 attributes, 1,849 tweens, 290 audio nodes.
    assert.ok(h.work.styles < 30000, 'do not rewrite inactive materials and distant year ticks')
    assert.ok(h.work.attributes < 3000, 'ARIA should update on semantic changes')
    assert.ok(h.work.tweens < 1000, 'hidden digits and unchanged slots should not animate')
    assert.ok(h.work.audioNodes < 150, 'clicks should reuse their gain/filter work')
    h.api.stop(); h.advance(2000)
    const idleWork = { ...h.work }
    h.advance(1000)
    assert.deepEqual(h.work, idleWork, 'idle controls should do no rendering or audio allocation')
  } finally { h.close() }
})

test('pointer capture caches geometry once; wrap, year snap, and wheel cancellation work', () => {
  const h = harness()
  try {
    const dial = h.element('.instrument'), timeline = h.element('.time-control')
    h.api.year(2026); h.api.value(50); h.advance(30)
    const point = angle => ({ clientX: 540 + 210 * Math.sin(angle * Math.PI / 180), clientY: 610 - 210 * Math.cos(angle * Math.PI / 180) })
    const before = h.layoutReads
    h.event(dial, 'pointerdown', point(179)); h.event(dial, 'pointermove', point(-179)); h.advance(9)
    assert.ok(h.api.state.rawValue > 50 && h.api.state.rawValue < 51)
    assert.equal(h.layoutReads, before + 1); assert.equal(dial.hasPointerCapture(1), true)
    h.event(dial, 'pointerup'); h.advance(700); assert.equal(dial.hasPointerCapture(1), false)
    h.event(dial, 'wheel', { deltaY: -15, deltaMode: 0 }); h.advance(20); h.key('ArrowUp')
    const precise = h.api.state.rawValue; h.advance(250); assert.equal(h.api.state.value, precise)
    const fixed = h.api.state.value, x = 216 + (2010.4 - 1974) / 52 * 648
    h.event(timeline, 'pointerdown', { clientX: x, clientY: 1068 }); h.advance(17)
    h.event(timeline, 'pointerup'); h.advance(700)
    assert.equal(h.api.state.year, 2011); assert.equal(h.api.state.value, fixed)
    assert.equal(h.layoutReads, before + 2)
  } finally { h.close() }
})

test('reduced motion paints only eras, uses a 150 ms fade, and never moves digits', () => {
  const h = harness()
  try {
    h.media.matches = true; h.media.dispatchEvent({ type: 'change' })
    h.api.year(2017); h.advance(200)
    assert.equal(h.api.state.year, 2011); assert.equal(h.api.state.paintedT, 1)
    h.api.year(2026)
    for (let i = 0; i < 20; i++) { h.advance(10); assert.ok([0, 1, 2].includes(h.api.state.paintedT)) }
    assert.equal(h.element('.anatomy').opacity, 1)
    h.api.value(51); h.advance(160)
    for (const slot of h.element('[data-value-digits]').querySelectorAll('.digit-slot')) assert.equal(slot.children[0].y, 0)
    assert.equal(h.api.state.tickerActive, false)
  } finally { h.close() }
})

test('17.6 second recording repeats at 60/120 Hz, locks value during morphs, and rate-limits sound', () => {
  for (const hz of [60, 120]) {
    const h = harness()
    try {
      h.api.start()
      const samples = []
      for (let frame = 0; frame < hz * 18; frame++) {
        h.advance(1000 / hz, hz)
        samples.push({ time: (frame + 1) / hz, ...h.api.state })
        assert.equal(h.element('.edge-and-scale').scale, 1, 'detents must not inflate the ring')
        assert.equal(h.element('[data-thumb]').scale, 1, 'year crossings must not inflate the thumb')
      }
      assert.ok(samples.some(s => s.year === 2011)); assert.ok(samples.some(s => s.year === 2026 && s.value === 100))
      assert.ok(samples.filter(s => s.time > 1.6 && s.time < 5.4).every(s => Math.abs(s.value - 55) < .1))
      assert.ok(samples.filter(s => s.time > 17 && s.time < 17.6).every(s => s.year === 1974 && Math.abs(s.value - 30) < 1e-6))
      assert.equal(h.api.state.recording, true)
      assert.ok(h.voices.length > 30)
      assert.ok(h.voices.every((voice, i) => !i || voice.at - h.voices[i - 1].at >= .04 - 1e-9))
      assert.ok(h.voices.some(voice => Math.abs(voice.length - .0035) < 1e-9 && voice.pitch >= 1 && voice.pitch <= 1.03))
      assert.ok([2, 5, 3].every(ms => h.haptics.some(haptic => haptic.ms === ms)))
      assert.ok(h.haptics.some(haptic => JSON.stringify(haptic.ms) === '[1,6,1]'))
      assert.ok(h.haptics.some(haptic => JSON.stringify(haptic.ms) === '[4,8,2]'))
      h.api.stop(); h.advance(1700); assert.equal(h.api.state.tickerActive, false)
      assert.equal(h.element('[data-idle]').opacity, .4)
    } finally { h.close() }
  }
})

test('old dial uses quiet friction and contact haptics; later voices use distinct cached samples', () => {
  const h = harness()
  try {
    const dial = h.element('.instrument')
    h.event(dial, 'pointerdown', { clientX: 540, clientY: 610 })
    h.advance(17)
    h.event(dial, 'pointermove', { clientX: 540, clientY: 450 })
    h.advance(100)
    h.event(dial, 'pointerup'); h.advance(750)
    assert.equal(h.voices.length, 0, 'a smooth pot must never click')
    assert.equal(h.haptics.length, 1, 'a smooth pot gives one contact cue, not fake detents')
    assert.equal(h.haptics[0].ms, 2)
    const friction = h.gains[1].gain.events
    assert.ok(friction.some(event => event.value > 0))
    assert.ok(friction.every(event => event.value * h.gains[0].gain.value < .0041), 'friction stays quiet even during a fast turn')
    assert.equal(friction.at(-1).value, 0)
    assert.ok(h.filters[0].frequency.events.every(event => event.value >= 650 && event.value <= 900))
    const firstVoice = h.voices.length
    h.api.year(2011); h.advance(200); h.key('End'); h.advance(50)
    h.api.year(2026); h.advance(200); h.key('Home')
    assert.ok(h.voices.length > firstVoice)
    for (const voice of h.voices) {
      assert.ok(voice.gain <= .032)
      assert.equal(voice.samples[0], 0)
      assert.equal(voice.samples.at(-1), 0)
    }
    const plastic = h.voices.find(voice => voice.length === SOUND.plastic.seconds)
    const ceramic = h.voices.find(voice => voice.length === SOUND.ceramic.seconds)
    const latch = h.voices.find(voice => voice.length === SOUND.era.seconds)
    assert.deepEqual(plastic.samples, buildSound('plastic', 48000))
    assert.deepEqual(ceramic.samples, buildSound('ceramic', 48000))
    assert.deepEqual(latch.samples, buildSound('era', 48000))
    h.api.year(2000); h.advance(100); h.key('ArrowRight', h.element('.time-control'))
    assert.deepEqual(h.voices.at(-1).samples, buildSound('year', 48000))
    h.api.year(2016.55); h.advance(100); h.api.value(0); h.advance(100)
    const previousCount = h.voices.length
    h.api.value(100); h.advance(20)
    const blend = h.voices.slice(previousCount)
    assert.equal(blend.length, 2, 'intermediate materials mix the two prepared voices')
    assert.equal(blend[0].at, blend[1].at)
    assert.equal(blend[0].samples, plastic.samples, 'plastic buffer must be reused')
    assert.equal(blend[1].samples, ceramic.samples, 'ceramic buffer must be reused')
    assert.ok(Math.abs(blend[0].gain - SOUND.plastic.gain * .63) < 1e-8)
    assert.ok(Math.abs(blend[1].gain - SOUND.ceramic.gain * .37) < 1e-8)
  } finally { h.close() }
})

test('backgrounding pauses the recording without losing its gesture state', () => {
  const h = harness()
  try {
    h.api.start(); h.advance(2200)
    const before = h.api.state.year
    h.document.hidden = true; h.document.dispatchEvent({ type: 'visibilitychange' }); h.advance(1500)
    assert.equal(h.api.state.year, before); assert.equal(h.api.state.tickerActive, false)
    h.document.hidden = false; h.document.dispatchEvent({ type: 'visibilitychange' }); h.advance(200)
    assert.ok(h.api.state.year > before); assert.equal(h.api.state.recording, true)
  } finally { h.close() }
})

test('stationary held pointers stop rendering and resume on movement without reading layout', () => {
  for (const year of [1974, 2011, 2026]) {
    const h = harness()
    try {
      h.api.year(year); h.advance(50)
      const dial = h.element('.instrument')
      h.event(dial, 'pointerdown', { clientX: 540, clientY: 610 })
      h.event(dial, 'pointermove', { clientX: 540, clientY: 570 }); h.advance(700)
      assert.equal(dial.hasPointerCapture(1), true)
      assert.equal(h.api.state.tickerActive, false)
      const frames = h.api.state.frames, value = h.api.state.value, reads = h.layoutReads
      h.advance(200)
      assert.equal(h.api.state.frames, frames, 'held still must not spin a render loop')
      h.event(dial, 'pointermove', { clientX: 540, clientY: 530 }); h.advance(700)
      assert.ok(h.api.state.value > value)
      assert.equal(h.layoutReads, reads)
      h.event(dial, 'pointerup'); h.advance(700)
      assert.equal(h.api.state.tickerActive, false)
    } finally { h.close() }
  }
})

test('audio stays lazy; unsupported or blocked tactile APIs never block input', () => {
  for (const options of [{ audio: false, vibration: 'unsupported' }, { audio: true, vibration: 'blocked' }]) {
    const h = harness(options)
    try {
      assert.equal(h.audioContexts.length, 0, 'mount must not create an AudioContext')
      h.api.year(2026); h.advance(50); h.key('End')
      assert.equal(h.api.state.value, 100)
      assert.equal(h.haptics.length, 0)
      if (!options.audio) assert.equal(h.voices.length, 0)
      h.advance(1600)
      assert.equal(h.api.state.tickerActive, false)
    } finally { h.close() }
  }
})

test('mute stops audio allocations while preserving haptics, then reuses the existing context', () => {
  const h = harness()
  try {
    h.api.year(2026); h.advance(100)
    h.key('m', h.document); h.advance(100)
    const voices = h.voices.length, nodes = h.work.audioNodes, haptics = h.haptics.length
    h.key('End'); h.advance(100)
    assert.equal(h.voices.length, voices); assert.equal(h.work.audioNodes, nodes)
    assert.ok(h.haptics.length > haptics)
    h.key('m', h.document); h.advance(100); h.key('Home')
    assert.ok(h.voices.length > voices); assert.equal(h.audioContexts.length, 1)
  } finally { h.close() }
})

test('unmount releases capture, listeners, timers, ticker, audio, and public diagnostics', () => {
  const h = harness()
  try {
    h.api.start(); h.advance(2500)
    const dial = h.element('.instrument')
    h.event(dial, 'pointerdown', { clientX: 540, clientY: 610 })
    assert.equal(dial.hasPointerCapture(1), true)
    h.dispose()
    assert.equal(dial.hasPointerCapture(1), false)
    assert.deepEqual(h.resourceCounts, { timers: 0, ticks: 0, listeners: 0 })
    assert.equal(h.window.dial, undefined)
    assert.ok(h.audioContexts.every(context => context.state === 'closed'))
    const work = { ...h.work }
    h.advance(2000); h.event(dial, 'pointerdown', { clientX: 540, clientY: 610 })
    assert.deepEqual(h.work, work)
  } finally { h.close() }
})
