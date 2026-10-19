import test from 'node:test'
import assert from 'node:assert/strict'
import { buildSound, SOUND } from '../app/lib/sound.mjs'

test('mechanical voices are quiet, deterministic, and start/end at zero at common sample rates', () => {
  for (const rate of [44100, 48000, 96000]) {
    for (const kind of Object.keys(SOUND)) {
      const samples = buildSound(kind, rate)
      assert.deepEqual(samples, buildSound(kind, rate))
      assert.equal(samples[0], 0); assert.equal(samples.at(-1), 0)
      assert.ok(samples.every(sample => Number.isFinite(sample) && Math.abs(sample) <= .800001))
      assert.ok(samples.some(sample => Math.abs(sample) > .1))
      assert.ok(samples.length / rate < .025, 'voices must end before the next rate-limited click')
    }
  }
})

test('year and era sounds have two distinct impulses; dial detents have one', () => {
  const rate = 48000
  const energy = (samples, start, end) => samples.slice(Math.round(start * rate), Math.round(end * rate)).reduce((sum, x) => sum + x * x, 0)
  for (const [kind, gapStart, gapEnd, finish] of [['year', .004, .005, .012], ['era', .009, .011, .024]]) {
    const samples = buildSound(kind, rate)
    assert.ok(energy(samples, 0, gapStart) > .1)
    assert.equal(energy(samples, gapStart, gapEnd), 0)
    assert.ok(energy(samples, gapEnd, finish) > .1)
  }
  const plastic = buildSound('plastic', rate), ceramic = buildSound('ceramic', rate)
  assert.ok(plastic.length > ceramic.length * 2, 'plastic detents should be softer and longer than ceramic ticks')
})
