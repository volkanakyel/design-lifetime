/** One source of truth for motion, geometry, and the continuous material model. */
export const motion = Object.freeze({
  ease: { out: [0.23, 1, 0.32, 1], inOut: [0.65, 0, 0.35, 1] },
  duration: { press: 150, sm: 180, smExit: 120, md: 240, mdExit: 170, lg: 320 },
})
export const ERAS = Object.freeze([1974, 2011, 2026])
export const ERA_NAMES = Object.freeze(['POTENTIOMETER', 'BRUSHED METAL', 'HAPTIC ENCODER'])
export const INITIAL_VALUE = 30
export const clamp = (n, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, n))
export const mix = (a, b, p) => a + (b - a) * p
export function smoothstep(start, end, x) {
  const p = clamp((x - start) / (end - start))
  return p * p * (3 - 2 * p)
}
export const yearToT = year => year <= 2011 ? clamp((year - 1974) / 37) : 1 + clamp((year - 2011) / 15)
export const tToYear = t => t <= 1 ? 1974 + clamp(t) * 37 : 2011 + clamp(t - 1) * 15
export const valueToAngle = value => clamp(value, 0, 100) * 2.7 - 135
export const nearestEra = year => ERAS.reduce((best, era) => Math.abs(year - era) < Math.abs(year - best) ? era : best, 1974)
export const snappedEra = year => ERAS.findIndex(era => Math.abs(year - era) < 0.002)
export const detentCount = t => t >= 2 - 1e-9 ? 23 : 20
export const detentStrength = t => clamp(t / 2)
export function magneticYear(year) {
  const nearest = nearestEra(year), d = year - nearest, radius = 1.5
  if (Math.abs(d) >= radius) return clamp(year, 1974, 2026)
  // The resistance and its slope join free travel smoothly at the capture radius.
  const falloff = (1 - (d / radius) ** 2) ** 2
  return clamp(nearest + d * (1 - .65 * falloff), 1974, 2026)
}
export function magneticValue(value, t) {
  const strength = detentStrength(t)
  if (!strength) return value
  const spacing = 100 / detentCount(t), nearest = Math.round(value / spacing) * spacing
  const d = value - nearest, radius = mix(1.15, 4 / 2.7, clamp(t - 1))
  if (Math.abs(d) >= radius) return value
  // Strength is exactly 0, .5, 1 at the three eras; the map stays monotonic.
  const resistance = 1 - .72 * strength * (1 - (d / radius) ** 2) ** 2
  return clamp(nearest + d * resistance, 0, 100)
}
/** Inclusive arrival, exclusive departure. Retains the original crossing algorithm. */
export function eachCrossing(from, to, count, callback, min = 0, max = 100) {
  if (Math.abs(to - from) < 1e-7) return
  const a = (from - min) * count / (max - min), b = (to - min) * count / (max - min)
  const direction = Math.sign(to - from), epsilon = 1e-6
  let i = direction > 0 ? Math.floor(a + epsilon) + 1 : Math.ceil(a - epsilon) - 1
  const end = direction > 0 ? Math.floor(b + epsilon) : Math.ceil(b - epsilon)
  for (; direction > 0 ? i <= end : i >= end; i += direction) {
    if (i >= 0 && i <= count) callback(i, min + i / count * (max - min))
  }
}
export function criticalStep(axis, target, omega, dt) {
  const offset = axis.position - target, c = axis.velocity + omega * offset, decay = Math.exp(-omega * dt)
  axis.position = target + (offset + c * dt) * decay
  axis.velocity = (axis.velocity - omega * c * dt) * decay
}
/** Critically damped, analytical release. Every gesture settles monotonically, including flicks. */
export function springStep(axis, target, dt) {
  const distance = target - axis.position, omega = Math.sqrt(500)
  if (Math.abs(distance) < 1e-8) { axis.position = target; axis.velocity = 0; return true }
  const direction = Math.sign(distance)
  // Keep useful arrival velocity; dissipate energy that would pass the stop or travel away.
  axis.velocity = direction * clamp(axis.velocity * direction, 0, omega * Math.abs(distance))
  criticalStep(axis, target, omega, Math.min(dt, .032))
  if (Math.abs(axis.position - target) < 0.001 && Math.abs(axis.velocity) < 0.02) {
    axis.position = target; axis.velocity = 0; return true
  }
  return false
}
function rgb(a, b, p) { return `rgb(${Math.round(mix(a[0], b[0], p))} ${Math.round(mix(a[1], b[1], p))} ${Math.round(mix(a[2], b[2], p))})` }
const white = [228, 228, 220], groove = [41, 43, 45], orange = [255, 90, 31]
export function createMorphSample() {
  return { t: 0, plate: 1, mass: 1, bodyScale: 1, capScale: 182 / 210, collar: 1,
    material: 0, grain: 0, specular: 0, knurl: 1, knurlAmplitude: 1,
    edgeScale: 1, edgeWidth: 12, edgeProgress: 0, edgeSpan: 360, edgeColor: '#080909', chrome: 0,
    well: 0, wellScale: 1, shadowBlur: 4, shadowY: 7, shadowOpacity: .55,
    pointerRadius: 153, pointerLength: 38, pointerWidth: 3.5, pointerColor: '#e4e4dc', pointerShadow: 1,
    activeArc: 0, readout: 0, readoutScale: .25, readoutBlur: 1, readoutWarmth: .3,
    printed: new Float32Array(51), leds: new Float32Array(21), ticks: new Float32Array(24) }
}
/** Pure material model. Passing a reusable output keeps the render loop allocation-light. */
export function sampleMorph(input, out = createMorphSample()) {
  const t = clamp(input, 0, 2)
  const depth = smoothstep(0, .38, t), depthOut = smoothstep(1, 1.52, t)
  const material = smoothstep(.16, .9, t), edge = smoothstep(.3, 1, t)
  const dissolve = smoothstep(1.12, 1.8, t), edgeOut = smoothstep(1.24, 1.96, t)
  const pointer = smoothstep(1.34, 1.98, t), readout = smoothstep(1.4, 1.96, t)
  out.t = t
  out.plate = 1 - smoothstep(.35, .96, t)
  out.mass = 1 - dissolve
  out.bodyScale = mix(1, .96, smoothstep(1, 1.8, t))
  out.capScale = mix(mix(182 / 210, .948, material), 1, smoothstep(1.14, 1.8, t))
  out.collar = 1 - material
  out.material = material
  out.specular = material * (1 - smoothstep(1.6, 1.8, t))
  out.grain = .5 * material * (1 - smoothstep(1.35, 1.8, t))
  out.knurlAmplitude = 1 - edge
  out.knurl = 1 - smoothstep(.68, 1, t)
  out.edgeScale = mix(1, 210 / 204, smoothstep(1.1, 1.72, t))
  out.edgeWidth = mix(12, 2 / out.edgeScale, edgeOut)
  out.edgeProgress = edgeOut
  out.edgeSpan = mix(360, 270, smoothstep(1.32, 1.92, t))
  out.edgeColor = t <= 1 ? rgb([8, 9, 9], [144, 147, 151], edge) : rgb([144, 147, 151], [42, 42, 45], edgeOut)
  out.chrome = edge * (1 - smoothstep(1.42, 1.98, t))
  out.well = depth * (1 - depthOut)
  out.wellScale = mix(1, 210 / 225, depthOut)
  out.shadowBlur = mix(4, 18, depth) * (1 - depthOut)
  out.shadowY = mix(7, 13, depth) * (1 - depthOut)
  out.shadowOpacity = mix(.55, .65, depth) * (1 - depthOut)
  out.pointerRadius = mix(mix(153, 151, smoothstep(.45, 1, t)), 210, pointer)
  out.pointerLength = mix(38, .001, pointer)
  out.pointerWidth = mix(mix(3.5, 5.2, material), 10, pointer)
  out.pointerColor = t <= 1 ? rgb(white, groove, smoothstep(.45, 1, t)) : rgb(groove, orange, pointer)
  out.pointerShadow = 1 - smoothstep(1.35, 1.8, t)
  out.activeArc = smoothstep(1.72, 2, t)
  out.readout = smoothstep(.72, 1, t)
  out.readoutScale = mix(.25, 1, readout)
  out.readoutBlur = 1 - readout
  out.readoutWarmth = .3 * (1 - readout)
  for (let i = 0; i < 51; i++) { const wave = i / 50 * .2; out.printed[i] = 1 - smoothstep(.42 + wave, .8 + wave, t) }
  for (let i = 0; i < 21; i++) { const wave = i / 20 * .18; out.leds[i] = smoothstep(.52 + wave, .82 + wave, t) * (1 - smoothstep(1.32 + wave, 1.74 + wave, t)) }
  for (let i = 0; i < 24; i++) { const wave = i / 23 * .18; out.ticks[i] = smoothstep(1.42 + wave, 1.82 + wave, t) }
  return out
}
export function point(radius, angle, center = 320) {
  const r = angle * Math.PI / 180
  return { x: +(center + radius * Math.sin(r)).toFixed(4), y: +(center - radius * Math.cos(r)).toFixed(4) }
}
export const printedScale = Array.from({ length: 51 }, (_, i) => ({
  i, major: i % 5 === 0, from: point(236, -135 + i * 5.4), to: point(i % 5 === 0 ? 249 : 242, -135 + i * 5.4), label: point(273, -135 + i * 5.4),
}))
export const ledScale = Array.from({ length: 21 }, (_, i) => ({ i, ...point(259, -135 + i * 13.5) }))
export const ringScale = Array.from({ length: 24 }, (_, i) => ({ i, from: point(229, -135 + i * 270 / 23), to: point(237, -135 + i * 270 / 23) }))
export const yearTicks = Array.from({ length: 53 }, (_, i) => {
  const year = 1974 + i, major = ERAS.includes(year), decade = year % 10 === 0
  return { year, x: i / 52 * 648, major, decade,
    height: major ? 16 : decade ? 12 : year % 5 === 0 ? 9 : year % 2 === 0 ? 6 : 3,
    labeled: major || (decade && ERAS.every(era => Math.abs(era - year) >= 5)),
  }
})
