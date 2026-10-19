import { test, expect, type Page } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

type Capture = { state: { value: number, year: number, paintedT: number, recording: boolean }, year: (year: number) => void, value: (value: number) => void }
declare global { interface Window { dial: Capture } }

async function ready(page: Page) {
  await page.goto('/')
  await page.waitForFunction(() => !!window.dial)
}
async function year(page: Page, target: number) {
  await page.evaluate(target => window.dial.year(target), target)
  await expect.poll(() => page.evaluate(() => window.dial.state.year)).toBe(target)
}

test('production startup is interactive at load without extra scripts, styles, or external fonts', async ({ page }) => {
  const requests: string[] = []
  page.on('request', request => requests.push(request.url()))
  await page.goto('/')
  expect(await page.evaluate(() => typeof window.dial?.year)).toBe('function')
  const assets = requests.map(url => new URL(url))
  expect(assets.every(url => url.origin === 'http://127.0.0.1:3049')).toBe(true)
  expect(assets.filter(url => url.pathname.endsWith('.js'))).toHaveLength(1)
  expect(assets.filter(url => url.pathname.endsWith('.css'))).toHaveLength(0)
  await page.getByRole('slider', { name: 'Rotary control' }).focus()
  await page.keyboard.press('ArrowUp')
  await expect(page.getByRole('slider', { name: 'Rotary control' })).toHaveAttribute('aria-valuenow', '31')
})

test('one anatomy at every year; fixed value, keyboard input, and no browser errors', async ({ page }) => {
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await ready(page)
  await expect(page.getByRole('heading', { level: 1, name: 'The life of a dial' })).toBeVisible()
  await page.evaluate(() => window.dial.value(49))
  await expect(page.getByRole('slider', { name: 'Rotary control' })).toHaveAttribute('aria-valuenow', '49')
  for (let target = 1974; target <= 2026; target++) {
    await year(page, target)
    await expect(page.locator('.anatomy')).toHaveCount(1)
    await expect(page.locator('[data-pointer]')).toHaveCount(1)
    expect(await page.evaluate(() => window.dial.state.value)).toBe(49)
  }
  const dial = page.getByRole('slider', { name: 'Rotary control' })
  await dial.focus(); await page.keyboard.press('ArrowRight')
  await expect(dial).toHaveAttribute('aria-valuenow', '50')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(dial).toHaveAttribute('aria-valuenow', '60')
  await expect(page.locator('.era, .segments')).toHaveCount(0)
  expect(errors).toEqual([])
})

test('capture intermediate objects at phone, recording, and 5K sizes', async ({ page }, testInfo) => {
  await ready(page)
  for (const [width, height] of [[390, 844], [1080, 1350], [5120, 2880]]) {
    await page.setViewportSize({ width: width!, height: height! })
    for (const target of [1974, 1990, 2011, 2016.55, 2020, 2026]) {
      await year(page, target)
      // Let the intentionally independent year digits finish their 180 ms entrance.
      await page.waitForTimeout(200)
      await page.screenshot({ path: testInfo.outputPath(`${width}-${target}.png`) })
    }
  }
})

test('reduced motion selects complete eras and preserves keyboard precision', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(page)
  await page.evaluate(() => window.dial.year(2017))
  await expect.poll(() => page.evaluate(() => window.dial.state.paintedT)).toBe(1)
  await expect(page.getByRole('slider', { name: 'Year' })).toHaveAttribute('aria-valuenow', '2011')
  await page.getByRole('slider', { name: 'Year' }).focus(); await page.keyboard.press('ArrowRight')
  await expect.poll(() => page.evaluate(() => window.dial.state.paintedT)).toBe(2)
  await expect(page.locator('.anatomy')).toHaveCSS('opacity', '1')
})

test('recording loops back to the same year and value', async ({ page }, testInfo) => {
  await page.addInitScript(() => {
    window.AudioContext = new Proxy(window.AudioContext, {
      construct(target, args, newTarget) {
        performance.mark('audio-context-start')
        try { return Reflect.construct(target, args, newTarget) }
        finally { performance.measure('audio-context-construction', 'audio-context-start') }
      },
    })
  })
  await ready(page)
  const devtools = await page.context().newCDPSession(page)
  await devtools.send('Performance.enable')
  const before = await devtools.send('Performance.getMetrics')
  await devtools.send('Tracing.start', {
    categories: 'devtools.timeline,toplevel,blink.user_timing',
    transferMode: 'ReturnAsStream',
  })
  await page.keyboard.press('r')
  await expect.poll(() => page.evaluate(() => window.dial.state.year), { timeout: 6000 }).toBe(2011)
  await expect.poll(() => page.evaluate(() => window.dial.state.year), { timeout: 5000 }).toBe(2026)
  await expect.poll(() => page.evaluate(() => window.dial.state.value), { timeout: 6000, intervals: [50] }).toBe(100)
  await expect.poll(() => page.evaluate(() => window.dial.state.year), { timeout: 6000, intervals: [50] }).toBe(1974)
  expect(await page.evaluate(() => window.dial.state.value)).toBe(30)
  expect(await page.evaluate(() => window.dial.state.recording)).toBe(true)
  const after = await devtools.send('Performance.getMetrics')
  const completed = new Promise<string>(resolve => devtools.once('Tracing.tracingComplete', event => resolve(event.stream!)))
  await devtools.send('Tracing.end')
  const handle = await completed
  let trace = ''
  for (;;) {
    const chunk = await devtools.send('IO.read', { handle })
    trace += chunk.data
    if (chunk.eof) break
  }
  await devtools.send('IO.close', { handle })
  const path = testInfo.outputPath('recording-performance.json')
  await writeFile(path, trace)
  await testInfo.attach('Chrome DevTools recording trace', { path, contentType: 'application/json' })
  const metrics = Object.fromEntries(after.metrics.map(metric => [metric.name,
    metric.value - (before.metrics.find(previous => previous.name === metric.name)?.value ?? 0)]))
  type TraceEvent = { name: string, ts: number, dur?: number, tid: number, pid: number, args?: { name?: string } }
  const events: TraceEvent[] = JSON.parse(trace).traceEvents
  const thread = events.find(event => event.name === 'thread_name' && event.args?.name === 'CrRendererMain')
  const mainEvents = events.filter(event => event.tid === thread?.tid && event.pid === thread?.pid && event.dur)
  const tasks = mainEvents.filter(event => /(?:^|::)RunTask$/.test(event.name))
    .map(event => event.dur! / 1000).sort((a, b) => a - b)
  const frames = mainEvents.filter(event => event.name === 'FireAnimationFrame')
  const frameDurations = frames.map(event => event.dur! / 1000).sort((a, b) => a - b)
  const forcedLayouts = mainEvents.filter(event => event.name === 'Layout' && frames.some(frame =>
    event.ts >= frame.ts && event.ts + event.dur! <= frame.ts + frame.dur!)).length
  const report = {
    durationSeconds: metrics.Timestamp,
    mainThreadMs: Number((metrics.TaskDuration! * 1000).toFixed(1)),
    scriptMs: Number((metrics.ScriptDuration! * 1000).toFixed(1)),
    layoutCount: metrics.LayoutCount,
    layoutMs: Number((metrics.LayoutDuration! * 1000).toFixed(1)),
    styleMs: Number((metrics.RecalcStyleDuration! * 1000).toFixed(1)),
    taskCount: tasks.length,
    p95TaskMs: tasks[Math.floor(tasks.length * .95)] ?? null,
    maxTaskMs: tasks.at(-1) ?? null,
    longTasks: tasks.filter(duration => duration > 50).length,
    audioContextConstructionMs: await page.evaluate(() => performance.getEntriesByName('audio-context-construction')[0]?.duration ?? null),
    animationFrames: frames.length,
    p95AnimationCallbackMs: frameDurations[Math.floor(frameDurations.length * .95)] ?? null,
    maxAnimationCallbackMs: frameDurations.at(-1) ?? null,
    forcedLayoutsInAnimationCallbacks: forcedLayouts,
  }
  console.info('Production recording performance:', report)
  await testInfo.attach('Recording performance summary', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  await devtools.detach()
  expect(tasks.length).toBeGreaterThan(0)
  expect(frames.length).toBeGreaterThan(0)
  expect(forcedLayouts, 'Animation callbacks must never force synchronous layout').toBe(0)
})
