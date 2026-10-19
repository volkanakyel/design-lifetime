import test from 'node:test'
import assert from 'node:assert/strict'
import {
  yearToT, tToYear, sampleMorph, createMorphSample, magneticYear, magneticValue,
  eachCrossing, detentCount, detentStrength, criticalStep, springStep, valueToAngle, yearTicks,
} from '../app/lib/morph.mjs'

test('year mapping is continuous, reversible, and anchored to the three eras', () => {
  assert.deepEqual([1974, 2011, 2026].map(yearToT), [0, 1, 2])
  for (let year = 1974; year <= 2026; year += .125) {
    assert.ok(Math.abs(tToYear(yearToT(year)) - year) < 1e-9)
    assert.ok(yearToT(year + .01) >= yearToT(year))
  }
})

test('one material model reaches the original materials and the final outline', () => {
  const pot = sampleMorph(0), metal = sampleMorph(1), hero = sampleMorph(2)
  assert.equal(pot.plate, 1); assert.equal(pot.knurlAmplitude, 1); assert.equal(pot.material, 0)
  assert.equal(metal.plate, 0); assert.equal(metal.material, 1); assert.equal(metal.specular, 1)
  assert.equal(metal.chrome, 1); assert.equal(metal.knurlAmplitude, 0)
  assert.equal(hero.mass, 0); assert.equal(hero.shadowOpacity, 0); assert.equal(hero.well, 0)
  assert.equal(hero.activeArc, 1); assert.equal(hero.readoutScale, 1); assert.equal(hero.pointerRadius, 210)
  assert.equal(hero.pointerColor, 'rgb(255 90 31)'); assert.equal(hero.pointerWidth, 10)
  assert.ok(hero.pointerLength < .002); assert.equal(hero.edgeSpan, 270)
  assert.ok(hero.ticks.every(opacity => opacity === 1)); assert.ok(hero.leds.every(opacity => opacity === 0))
  assert.ok(Math.abs(hero.edgeWidth * hero.edgeScale - 2) < 1e-9)
})

test('every intermediate sample is finite and deterministic; final 20% has no body', () => {
  const reusable = createMorphSample(), printed = reusable.printed
  for (let i = 0; i <= 2000; i++) {
    const t = i / 1000, sample = sampleMorph(t, reusable)
    assert.equal(sample, reusable); assert.equal(sample.printed, printed)
    for (const [key, value] of Object.entries(sample)) {
      if (typeof value === 'number') assert.ok(Number.isFinite(value), `${key} at ${t}`)
      if (value instanceof Float32Array) assert.ok(value.every(x => x >= 0 && x <= 1))
    }
    if (t >= 1.8) { assert.equal(sample.mass, 0); assert.equal(sample.specular, 0) }
  }
  assert.deepEqual(sampleMorph(1.37), sampleMorph(1.37))
  assert.ok(Math.abs(valueToAngle(49) + 2.7) < 1e-9)
})

test('scale changes travel around the dial instead of fading as a group', () => {
  const first = sampleMorph(.65), second = sampleMorph(1.65)
  assert.ok(first.printed[0] < first.printed[50])
  assert.ok(first.leds[0] > first.leds[20])
  assert.ok(second.leds[0] < second.leds[20])
  assert.ok(second.ticks[0] > second.ticks[23])
})

test('year and value magnets are monotonic, continuous, and preserve exact detents', () => {
  for (const era of [1974, 2011, 2026]) assert.equal(magneticYear(era), era)
  for (let year = 1974; year < 2026; year += .01) assert.ok(magneticYear(year + .01) >= magneticYear(year) - 1e-9)
  assert.ok(Math.abs(magneticYear(2009.5 + 1e-6) - magneticYear(2009.5 - 1e-6)) < 1e-5)
  const epsilon = 1e-5
  for (const edge of [2009.5, 2012.5]) {
    const slope = (magneticYear(edge + epsilon) - magneticYear(edge - epsilon)) / (2 * epsilon)
    assert.ok(Math.abs(slope - 1) < .0001, 'capture edge must not change drag speed abruptly')
  }
  for (const t of [0, .6, 1, 1.37, 2]) {
    for (let value = 0; value < 100; value += .02) assert.ok(magneticValue(value + .02, t) >= magneticValue(value, t) - 1e-9)
  }
  assert.deepEqual([0, 1, 2].map(detentStrength), [0, .5, 1])
  assert.equal(detentCount(1.999), 20); assert.equal(detentCount(2), 23)
})

test('fast crossings include every arrival once, exclude departure, and reverse correctly', () => {
  const forward = [], reverse = [], split = [], years = []
  eachCrossing(0, 100, 23, index => forward.push(index))
  eachCrossing(100, 0, 23, index => reverse.push(index))
  eachCrossing(0, 50, 20, index => split.push(index))
  eachCrossing(50, 100, 20, index => split.push(index))
  eachCrossing(1974, 2026, 52, (_, year) => years.push(year), 1974, 2026)
  assert.deepEqual(forward, Array.from({ length: 23 }, (_, i) => i + 1))
  assert.deepEqual(reverse, Array.from({ length: 23 }, (_, i) => 22 - i))
  assert.equal(new Set(split).size, 20); assert.equal(split.length, 20)
  assert.equal(years.length, 52); assert.ok(years.includes(2011)); assert.equal(years.at(-1), 2026)
})

test('critical follow gives the same result at 60 and 120 Hz', () => {
  const states = [60, 120].map(hz => {
    const axis = { position: 0, velocity: 0 }
    for (let i = 0; i < hz / 5; i++) criticalStep(axis, 70, 50, 1 / hz)
    return axis
  })
  assert.ok(Math.abs(states[0].position - states[1].position) < 1e-10)
  assert.ok(states[0].position < 70)
})

test('release springs stay monotonic at 60/120 Hz, even with fast or opposing release velocity', () => {
  for (const hz of [60, 120]) {
    for (const start of [49, 51]) {
      for (const velocity of [-200, -8, 0, 8, 200]) {
        const axis = { position: start, velocity }
        for (let i = 0; i < hz; i++) {
          const before = Math.abs(axis.position - 50)
          springStep(axis, 50, 1 / hz)
          assert.ok(Math.abs(axis.position - 50) <= before, 'release must approach the stop')
          assert.ok((axis.position - 50) * (start - 50) >= 0, 'release must never pass the stop')
        }
        assert.equal(axis.position, 50); assert.equal(axis.velocity, 0)
      }
    }
    const alreadyThere = { position: 50, velocity: 20 }
    assert.equal(springStep(alreadyThere, 50, 1 / hz), true)
    assert.equal(alreadyThere.position, 50)
  }
  const states = [60, 120].map(hz => {
    const axis = { position: 49, velocity: 200 }
    for (let i = 0; i < hz / 5; i++) springStep(axis, 50, 1 / hz)
    return axis.position
  })
  assert.ok(Math.abs(states[0] - states[1]) < 1e-10)
})

test('timeline marks every year, with legible decade labels separated from era anchors', () => {
  assert.equal(yearTicks.length, 53)
  assert.deepEqual(yearTicks.map(tick => tick.year), Array.from({ length: 53 }, (_, i) => 1974 + i))
  assert.deepEqual(yearTicks.filter(tick => tick.labeled).map(tick => tick.year), [1974, 1980, 1990, 2000, 2011, 2020, 2026])
})
