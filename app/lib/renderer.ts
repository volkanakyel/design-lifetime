import { gsap } from 'gsap'
import { createDigits } from './digits'
import { createMorphSample, sampleMorph, valueToAngle, ERA_NAMES, snappedEra, motion, smoothstep } from './morph.mjs'

type Node = HTMLElement & SVGElement
export function createRenderer(root: HTMLElement, reduced: () => boolean) {
  const $ = (name: string) => root.querySelector<Node>(name)!
  const all = (name: string) => Array.from(root.querySelectorAll<Node>(name))
  const n = {
    plate: $('[data-plate]'), shadow: $('[data-shadow]'), well: $('[data-well]'), body: $('[data-body]'),
    collar: $('[data-collar]'), cap: $('[data-cap]'), material: $('[data-material]'), specular: $('[data-specular]'),
    grain: $('[data-grain]'), lathe: $('[data-lathe]'), edge: $('[data-edge]'), rim: $('[data-rim]'), mask: $('[data-bevel-mask]'),
    chrome: $('[data-chrome]'), knurl: $('[data-knurl]'), ridge: $('[data-ridge-amplitude]'),
    pointerPosition: $('[data-pointer-position]'), pointerLength: $('[data-pointer-length]'), pointer: $('[data-pointer]'), pointerShadow: $('[data-pointer-shadow]'),
    arc: $('[data-active-arc]'), arcA: $('[data-arc-a]'), arcB: $('[data-arc-b]'),
    grainRotor: $('[data-grain-rotor]'), knurlRotor: $('[data-knurl-rotor]'), pointerRotor: $('[data-pointer-rotor]'),
    readout: $('[data-readout]'), timePosition: $('[data-time-position]'), eraCaption: $('[data-era-caption]'), betweenCaption: $('[data-between-caption]'),
    dial: $('.instrument'), timeline: $('.time-control'),
  }
  const printed = all('[data-printed]'), ledScale = all('[data-led-scale]'), tickScale = all('[data-tick-scale]'), leds = all('[data-led]')
  const yearTicks = all('[data-year-tick]')
  const valueDigits = createDigits($('[data-value-digits]'), reduced), yearDigits = createDigits($('[data-year-digits]'), reduced)
  const sample = createMorphSample()
  let lastT = -1, lastValue = -1, lastPlay = 0, lastYear = -1, lastLed = -1, lastCaption = -2
  let lastIntegerValue = -1, lastIntegerYear = -1, headStart = 0, headEnd = 0
  const writes = new WeakMap<Node, Record<string, string>>()
  function changed(node: Node, key: string, value: string) {
    let cache = writes.get(node)
    if (!cache) { cache = {}; writes.set(node, cache) }
    if (cache[key] === value) return false
    cache[key] = value; return true
  }
  function style(node: Node, key: 'opacity' | 'transform' | 'filter' | 'strokeWidth', value: string) {
    if (changed(node, key, value)) node.style[key] = value
  }
  function attr(node: Node, key: string, value: string) {
    if (changed(node, `@${key}`, value)) node.setAttribute(key, value)
  }
  const opacity = (node: Node, value: number) => style(node, 'opacity', String(value))

  function morph(t: number, force = false) {
    if (lastT === t && !force) return
    lastT = t; sampleMorph(t, sample)
    opacity(n.plate, sample.plate)
    opacity(n.body, sample.mass); style(n.body, 'transform', `scale(${sample.bodyScale})`)
    style(n.cap, 'transform', `scale(${sample.capScale})`); opacity(n.collar, sample.collar)
    opacity(n.material, sample.material); opacity(n.specular, sample.specular)
    opacity(n.grain, sample.grain); opacity(n.lathe, sample.grain)
    opacity(n.knurl, sample.knurl); attr(n.ridge, 'transform', `scale(1 ${sample.knurlAmplitude})`)
    style(n.edge, 'transform', `scale(${sample.edgeScale})`)
    attr(n.rim, 'stroke', sample.edgeColor)
    for (const node of [n.rim, n.mask]) {
      // The substantial bevel follows frame size; the finished ring remains a crisp 2 CSS px.
      style(node, 'strokeWidth', `calc(${12 * (1 - sample.edgeProgress) / 10.8}cqw + ${2 * sample.edgeProgress}px)`)
      attr(node, 'stroke-dasharray', `${sample.edgeSpan} 360`)
    }
    opacity(n.chrome, sample.chrome)
    opacity(n.well, sample.well); style(n.well, 'transform', `scale(${sample.wellScale})`)
    opacity(n.shadow, sample.shadowOpacity)
    style(n.shadow, 'transform', `translateY(${sample.shadowY / 10.8}cqw)`)
    style(n.shadow, 'filter', `blur(${sample.shadowBlur / 10.8}cqw)`)
    attr(n.pointerPosition, 'transform', `translate(320 ${320 - sample.pointerRadius})`)
    attr(n.pointerLength, 'transform', `scale(1 ${sample.pointerLength / 38})`)
    // Non-scaling stroke preserves round caps as the line contracts. Container units retain stage scale.
    style(n.pointer, 'strokeWidth', `${sample.pointerWidth / 10.8}cqw`); attr(n.pointer, 'stroke', sample.pointerColor)
    style(n.pointerShadow, 'strokeWidth', `${(sample.pointerWidth + 2.5) / 10.8}cqw`); opacity(n.pointerShadow, sample.pointerShadow)
    opacity(n.arc, sample.activeArc)
    opacity(n.readout, sample.readout); style(n.readout, 'transform', `scale(${sample.readoutScale})`)
    style(n.readout, 'filter', reduced() ? 'none' : `blur(${sample.readoutBlur}px) sepia(${sample.readoutWarmth})`)
    for (let i = 0; i < printed.length; i++) opacity(printed[i]!, sample.printed[i]!)
    for (let i = 0; i < ledScale.length; i++) opacity(ledScale[i]!, sample.leds[i]!)
    for (let i = 0; i < tickScale.length; i++) opacity(tickScale[i]!, sample.ticks[i]!)
  }

  function value(value: number, play = 0, force = false) {
    if (value === lastValue && play === lastPlay && !force) return
    const rotation = `rotate(${valueToAngle(value) + play}deg)`, span = value * 2.7
    style(n.grainRotor, 'transform', rotation); style(n.knurlRotor, 'transform', rotation); style(n.pointerRotor, 'transform', rotation)
    style(n.arcA, 'transform', `rotate(${Math.min(span, 180) - 180}deg)`)
    style(n.arcB, 'transform', `rotate(${Math.max(0, span - 180) - 180}deg)`)
    opacity(n.arcA, span > 0 ? 1 : 0); opacity(n.arcB, span > 180 ? 1 : 0)
    const led = Math.floor(value / 5 + .00001)
    if (lastLed !== led || force) {
      leds.forEach((el, i) => {
        const on = i <= led ? 1 : 0
        if (force || (i <= lastLed) !== (i <= led)) {
          if (force || sample.leds[i]! === 0) { gsap.killTweensOf(el); gsap.set(el, { opacity: on }) }
          else gsap.to(el, { opacity: on, duration: motion.duration.smExit / 1000 })
        }
      })
      lastLed = led
    }
    const integer = Math.round(value)
    if (integer !== lastIntegerValue || force) {
      valueDigits(value, force, sample.readout > 0)
      attr(n.dial, 'aria-valuenow', String(integer))
      attr(n.dial, 'aria-valuetext', `${integer}, ${Math.round(lastYear < 0 ? 1974 : lastYear)}`)
      lastIntegerValue = integer
    }
    lastValue = value; lastPlay = play
  }

  function year(year: number, force = false) {
    if (year === lastYear && !force) return
    lastYear = year
    style(n.timePosition, 'transform', `translateX(${(year - 1974) / 52 * 100}%)`)
    // A quiet read head lights nearby graduations without scaling the thumb or ruler.
    const start = Math.max(0, Math.floor(year - 1974) - 2), end = Math.min(52, Math.ceil(year - 1974) + 2)
    for (let i = headStart; i <= headEnd; i++) if (i < start || i > end) opacity(yearTicks[i]!, 0)
    for (let i = start; i <= end; i++) opacity(yearTicks[i]!, .65 * (1 - smoothstep(0, 2, Math.abs(1974 + i - year))))
    headStart = start; headEnd = end
    yearDigits(year, force)
    const era = snappedEra(year), name = era >= 0 ? ERA_NAMES[era]!.toLowerCase() : 'in between eras'
    const integer = Math.round(year)
    if (integer !== lastIntegerYear || era !== lastCaption || force) {
      attr(n.timeline, 'aria-valuenow', String(integer))
      attr(n.timeline, 'aria-valuetext', `${integer}, ${name}`)
      attr(n.dial, 'aria-valuetext', `${Math.round(lastValue)}, ${integer}`)
      if (integer !== lastIntegerYear || force) n.betweenCaption.textContent = String(integer)
      lastIntegerYear = integer
    }
    if (lastCaption !== era || force) {
      // One caption element; no material layer participates in this text crossfade.
      if (era >= 0) n.eraCaption.textContent = ERA_NAMES[era]!
      const duration = force ? 0 : Math.min(motion.duration.sm, reduced() ? 150 : Infinity) / 1000
      gsap.to(n.eraCaption, { opacity: era >= 0 ? 1 : 0, duration })
      gsap.to(n.betweenCaption, { opacity: era >= 0 ? 0 : 1, duration })
      lastCaption = era
    }
  }
  return { morph, value, year, digits: valueDigits, yearDigits }
}
