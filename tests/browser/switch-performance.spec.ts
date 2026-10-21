import { test, expect } from '@playwright/test'
import { writeFile } from 'node:fs/promises'

test('one sleeping clock, no forced layouts, and measured phone/5K budgets', async ({ browser }, info) => {
  test.setTimeout(90000)
  const report: Record<string, any[]> = {}
  for (const profile of [
    { name: 'phone-6x', width: 390, height: 844, dpr: 3, cpu: 6 },
    { name: 'desktop-5k', width: 5120, height: 2880, dpr: 1, cpu: 1 },
  ]) {
    report[profile.name] = []
    for (let run = 0; run < 3; run++) {
      const context = await browser.newContext({
        viewport: { width: profile.width, height: profile.height },
        deviceScaleFactor: profile.dpr,
        hasTouch: profile.name.startsWith('phone'),
      })
      await context.addInitScript(() => {
        const nativeRAF = requestAnimationFrame, nativeCancel = cancelAnimationFrame
        const active = new Set<number>()
        const metrics = { maxRAF: 0, cls: 0, callbackMs: [] as number[], gaps: [] as number[], previous: 0, audioInitMs: 0, audioInitAt: 0 }
        ;(window as any).frameMetrics = metrics
        const Base = window.AudioContext
        window.AudioContext = new Proxy(Base, {
          construct(target, args) {
            const start = performance.now()
            try { return Reflect.construct(target, args) }
            finally { metrics.audioInitMs = performance.now() - start; metrics.audioInitAt = start }
          },
        })
        window.requestAnimationFrame = callback => {
          const id = nativeRAF(timestamp => {
            active.delete(id)
            const start = performance.now()
            callback(timestamp)
            metrics.callbackMs.push(performance.now() - start)
            if (metrics.previous) metrics.gaps.push(timestamp - metrics.previous)
            metrics.previous = timestamp
          })
          active.add(id); metrics.maxRAF = Math.max(metrics.maxRAF, active.size)
          return id
        }
        window.cancelAnimationFrame = id => { active.delete(id); nativeCancel(id) }
        new PerformanceObserver(list => {
          for (const e of list.getEntries() as any) if (!e.hadRecentInput) metrics.cls += e.value
        }).observe({ type: 'layout-shift', buffered: true })
      })
      const page = await context.newPage()
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu })
      await page.goto('/switch/index.html')
      await page.waitForFunction(() => !!(window as any).gsap && !!(window as any).switchStudy)
      await page.waitForTimeout(200)
      await page.evaluate(() => {
        const m = (window as any).frameMetrics
        m.maxRAF = 0; m.callbackMs = []; m.gaps = []; m.previous = 0
        m.interactionStart = performance.now()
        const gsap = (window as any).gsap, original = gsap.timeline
        gsap.timeline = (...args: any[]) => {
          const start = performance.now(), timeline = original(...args)
          m.timelineInitMs = performance.now() - start
          return timeline
        }
      })
      await cdp.send('Tracing.start', { categories: 'devtools.timeline,toplevel', transferMode: 'ReturnAsStream' })
      await page.keyboard.press('r')
      await page.waitForTimeout(5200)
      await page.keyboard.press('Escape')
      await expect.poll(() => page.evaluate(() => (window as any).switchStudy.state.rafActive)).toBe(false)
      const completed = new Promise<string>(resolve => cdp.once('Tracing.tracingComplete', e => resolve(e.stream!)))
      await cdp.send('Tracing.end')
      const handle = await completed
      let trace = ''
      for (;;) {
        const chunk = await cdp.send('IO.read', { handle })
        trace += chunk.data
        if (chunk.eof) break
      }
      await cdp.send('IO.close', { handle })
      const events = JSON.parse(trace).traceEvents
      const thread = events.find((e: any) => e.name === 'thread_name' && e.args?.name === 'CrRendererMain')
      const main = events.filter((e: any) => e.tid === thread?.tid && e.pid === thread?.pid && e.dur)
      const frames = main.filter((e: any) => e.name === 'FireAnimationFrame')
      const forced = main.filter((e: any) => e.name === 'Layout' && frames.some((f: any) => e.ts >= f.ts && e.ts + e.dur <= f.ts + f.dur))
      const tasks = main.filter((e: any) => /(?:^|::)RunTask$/.test(e.name)).map((e: any) => e.dur / 1000).sort((a: number, b: number) => a - b)
      const metrics = await page.evaluate(() => (window as any).frameMetrics)
      const costs = metrics.callbackMs.sort((a: number, b: number) => a - b)
      const summary = {
        maxConcurrentRAF: metrics.maxRAF,
        cls: metrics.cls,
        p95CallbackMs: costs[Math.floor(costs.length * .95)],
        maxCallbackMs: costs.at(-1),
        p95TaskMs: tasks[Math.floor(tasks.length * .95)],
        maxTaskMs: tasks.at(-1),
        longTasks: tasks.filter((ms: number) => ms > 50).length,
        forcedLayouts: forced.length,
        audioInitMs: metrics.audioInitMs,
        audioPreparedBeforeInput: metrics.audioInitAt + metrics.audioInitMs < metrics.interactionStart,
        timelineInitMs: metrics.timelineInitMs,
        measuredFrameIntervalMs: metrics.gaps.filter((ms: number) => ms > 0 && ms < 50).sort((a: number, b: number) => a - b)[Math.floor(metrics.gaps.length / 2)],
        fcp: await page.evaluate(() => performance.getEntriesByName('first-contentful-paint')[0]?.startTime),
      }
      report[profile.name].push(summary)
      if (run === 0) {
        await writeFile(info.outputPath(`${profile.name}-trace.json`), trace)
        await page.screenshot({ path: info.outputPath(`${profile.name}.png`) })
      }
      expect(summary.maxConcurrentRAF).toBe(1)
      expect(summary.cls).toBe(0)
      expect(summary.forcedLayouts).toBe(0)
      // 4–5 ms JS budget leaves room for style/paint at 120 Hz.
      expect(summary.p95CallbackMs).toBeLessThan(5)
      await context.close()
    }
  }
  console.info('Switch performance:', JSON.stringify(report))
  await writeFile(info.outputPath('performance-summary.json'), JSON.stringify(report, null, 2))
  await info.attach('Phone and 5K performance', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
})

test('spring integration agrees at 60 and 120 Hz, including rapid reversal', async ({ page }) => {
  await page.goto('/switch/index.html')
  const differences = await page.evaluate(() => {
    const { spring } = (window as any).switchStudy
    const simulate = (hz: number, k: number, c: number) => {
      let x = 0, v = 0
      for (let i = 0; i < hz; i++) [x, v] = spring(x, v, i < hz / 2 ? 1 : 0, k, c, 1 / hz)
      return [x, v]
    }
    return [[2100, 70], [780, 46], [600, 30], [676, 52]].map(([k, c]) => {
      const a = simulate(60, k!, c!), b = simulate(120, k!, c!)
      return Math.max(...a.map((v, i) => Math.abs(v - b[i]!)))
    })
  })
  differences.forEach(d => expect(d).toBeLessThan(1e-10))
})

test('coupled liquid response matches at 60/120 Hz and limits endpoint overshoot', async ({ page }) => {
  await page.goto('/switch/index.html')
  const result = await page.evaluate(() => {
    const { advanceGesture } = (window as any).switchStudy
    const simulate = (hz: number, reverse: boolean) => {
      const s = { pos: 0, velocity: 0, stretch: 1, stretchV: 0, flow: 0, flowV: 0 }
      let peak = 0, maxStretch = 1, minStretch = 1
      for (let i = 0; i < hz; i++) {
        advanceGesture(s, reverse && i >= hz / 4 && i < hz / 2 ? 0 : 1, 2, 1 / hz)
        peak = Math.max(peak, s.pos); maxStretch = Math.max(maxStretch, s.stretch); minStretch = Math.min(minStretch, s.stretch)
      }
      return { state: s, peak, maxStretch, minStretch }
    }
    return [false, true].map(reverse => ({ a: simulate(60, reverse), b: simulate(120, reverse) }))
  })
  for (const { a, b } of result) {
    for (const key of ['pos', 'velocity', 'stretch', 'stretchV', 'flow', 'flowV'] as const) expect(Math.abs(a.state[key] - b.state[key])).toBeLessThan(.0003)
    expect(a.peak).toBeLessThan(1.006)
    expect(a.maxStretch).toBeGreaterThan(1.2)
    expect(a.maxStretch).toBeLessThan(1.26)
    expect(a.minStretch).toBeGreaterThan(.97)
  }
})
