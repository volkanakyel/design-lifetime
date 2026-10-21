import { test, expect, type Page } from '@playwright/test'

const study = (page: Page) => page.evaluate(() => (window as any).switchStudy.state)
async function ready(page: Page) {
  await page.goto('/switch')
  await page.waitForFunction(() => !!(window as any).switchStudy)
}
async function era(page: Page, key: string) {
  await page.keyboard.press(key)
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
}

test('standalone first frame, exact tokens, all years preserve one object and on/off state', async ({ page }, info) => {
  const errors: string[] = []
  page.on('pageerror', e => errors.push(e.message))
  await ready(page)
  await expect(page).toHaveTitle('The Life of a Switch — Episode 02')
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  expect(await page.evaluate(() => {
    const ids = [...document.querySelectorAll('[id]')].map(n => n.id)
    return ids.filter((id, index) => ids.indexOf(id) !== index)
  })).toEqual([])
  expect(await page.evaluate(() => (window as any).switchStudy.tokens)).toEqual({
    duration: { press: 150, sm: 180, md: 240, lg: 320 },
    ease: [[.23, 1, .32, 1], [.65, 0, .35, 1]],
  })
  await page.screenshot({ path: info.outputPath('1965-off.png') })
  await page.setViewportSize({ width: 2160, height: 2700 })
  await page.locator('.instrument').screenshot({ path: info.outputPath('1965-detail.png'), scale: 'device' })
  await page.setViewportSize({ width: 1080, height: 1350 })
  await page.getByRole('switch').click()
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  await page.screenshot({ path: info.outputPath('1965-on.png') })
  await page.getByRole('slider').focus()
  for (let year = 1965; year <= 2026; year++) {
    if (year > 1965) await page.keyboard.press('ArrowRight')
    await expect(page.getByRole('slider')).toHaveAttribute('aria-valuenow', String(year))
    await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
    expect(await page.locator('#actuator').count()).toBe(1)
    expect(await page.locator('#base').count()).toBe(1)
    if ([1976, 1986, 1997, 2007, 2016, 2026].includes(year)) {
      await page.waitForTimeout(200)
      await page.screenshot({ path: info.outputPath(`${year}-on.png`) })
    }
  }
  expect(errors).toEqual([])
})

test('over-center resistance, pivot projection, cancel, tap and drag commit exactly once per flip', async ({ page }, info) => {
  await ready(page)
  await page.evaluate(() => {
    (window as any).events = { flip: [], settle: [] }
    for (const type of ['flip', 'settle']) document.addEventListener(`switch:${type}`, (e: any) => (window as any).events[type].push(e.detail))
  })
  const box = (await page.getByRole('switch').boundingBox())!
  const travel = await page.evaluate(() => (window as any).switchStudy.anatomy(0).travel)
  const scale = box.width / 640
  const x = box.x + box.width / 2, y = box.y + box.height / 2 + travel * scale
  const restLength = await page.locator('[data-thumb-shape]').first().evaluate(node => new DOMMatrix(getComputedStyle(node).transform).d)
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x, y - travel * 2 * .49 * scale, { steps: 12 })
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  expect((await study(page)).pos).toBeGreaterThan(.2)
  const projectedLength = await page.locator('[data-thumb-shape]').first().evaluate(node => new DOMMatrix(getComputedStyle(node).transform).d)
  expect(projectedLength).toBeLessThan(restLength * .35)
  await page.locator('.instrument').screenshot({ path: info.outputPath('1965-pivot.png') })
  await page.mouse.up()
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  expect((await study(page)).pos).toBe(0)
  await page.mouse.move(x, y); await page.mouse.down()
  await page.mouse.move(x, y - travel * 2 * .62 * scale, { steps: 12 })
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'true')
  await page.mouse.move(x, y + travel * 2 * .62 * scale, { steps: 8 })
  await page.mouse.up()
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  expect(await page.evaluate(() => (window as any).events.flip.length)).toBe(1)
  expect(await page.evaluate(() => (window as any).events.settle.length)).toBe(1)
  await page.getByRole('switch').press('Space')
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  expect(await page.evaluate(() => (window as any).events.flip.length)).toBe(2)
  expect(await page.evaluate(() => (window as any).events.settle.length)).toBe(2)
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
})

test('modern snap stretches, squashes, interrupts without duplicate effects, then sleeps', async ({ page }, info) => {
  await ready(page); await era(page, '3')
  await page.evaluate(() => {
    const samples: number[] = []
    ;(window as any).stretchSamples = samples
    let end = performance.now() + 1800
    function sample() { samples.push((window as any).switchStudy.state.stretch); if (performance.now() < end) requestAnimationFrame(sample) }
    requestAnimationFrame(sample)
  })
  await page.getByRole('switch').click()
  await page.waitForTimeout(110)
  await page.screenshot({ path: info.outputPath('2026-stretch.png') })
  await page.waitForTimeout(240); await page.getByRole('switch').press('Enter')
  await page.waitForTimeout(340); await page.getByRole('switch').press('Enter')
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  const samples = await page.evaluate(() => (window as any).stretchSamples as number[])
  expect(Math.max(...samples)).toBeGreaterThan(1.12)
  expect(Math.max(...samples)).toBeLessThanOrEqual(1.26)
  expect(Math.min(...samples)).toBeLessThan(.99)
  expect((await study(page)).on).toBe(true)
  expect((await study(page)).stretch).toBe(1)
  await page.screenshot({ path: info.outputPath('2026-settled.png') })
})

test('modern contact flexes immediately; reversals retain velocity and settle without ringing', async ({ page }, info) => {
  await ready(page); await era(page, '3')
  const box = (await page.getByRole('switch').boundingBox())!
  await page.mouse.move(box.x + box.width / 2 - 78, box.y + box.height / 2)
  await page.mouse.down()
  await expect.poll(async () => (await study(page)).press, { intervals: [20] }).toBeGreaterThan(.8)
  await expect(page.getByRole('switch')).toHaveAttribute('aria-checked', 'false')
  await expect(page.locator('#liquid-light')).not.toHaveCSS('opacity', '0')
  await page.locator('.instrument').screenshot({ path: info.outputPath('2026-contact.png') })
  await page.mouse.up()
  await page.waitForTimeout(70)
  const continuity = await page.evaluate(() => {
    const before = (window as any).switchStudy.state
    document.querySelector('.instrument')!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    const after = (window as any).switchStudy.state
    return { before, after }
  })
  expect(Math.abs(continuity.before.velocity)).toBeGreaterThan(.1)
  expect(continuity.after.velocity).toBe(continuity.before.velocity)
  expect(continuity.after.pos).toBe(continuity.before.pos)
  expect(continuity.after.stretch).toBe(continuity.before.stretch)
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  const final = await study(page)
  expect(final.pos).toBe(0); expect(final.press).toBe(0)
  expect(final.stretch).toBe(1); expect(final.flow).toBe(0)
  await expect(page.locator('#liquid-light')).toHaveCSS('opacity', '0')
  await expect(page.locator('#thumb-skin')).toHaveCSS('opacity', '1')
})

test('morph keeps actuator contained through every intermediate contour', async ({ page }) => {
  await ready(page)
  const overflow = await page.evaluate(() => {
    const { anatomy, actuatorProfile } = (window as any).switchStudy
    let overflow = 0
    for (let i = 0; i <= 2000; i++) for (const p of [0, 1]) {
      const g = anatomy(i / 1000), a = actuatorProfile(g, p)
      const s = Math.sin(g.axis), c = Math.cos(g.axis), sign = p * 2 - 1
      const x = sign * s * g.travel, y = -sign * c * g.travel
      const maxX = Math.max(Math.abs(x + s * a.length / 2) + a.top, Math.abs(x - s * a.length / 2) + a.bottom)
      const maxY = Math.max(Math.abs(y - c * a.length / 2) + a.top, Math.abs(y + c * a.length / 2) + a.bottom)
      overflow = Math.max(overflow, maxX - g.width / 2, maxY - g.height / 2)
    }
    return overflow
  })
  expect(overflow).toBe(0)
})

test('year magnet is monotonic; arrows precise; era labels only on detents; H and M work', async ({ page }) => {
  await ready(page)
  const slider = page.getByRole('slider'), rect = (await slider.boundingBox())!
  await page.mouse.click(rect.x + rect.width * (2006 - 1965) / 61, rect.y + 48)
  await expect.poll(async () => (await study(page)).year).toBe(2007)
  await expect(page.locator('.era-name span').nth(1)).toHaveCSS('opacity', '1')
  await slider.press('ArrowLeft')
  await expect(slider).toHaveAttribute('aria-valuenow', '2006')
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  await expect(page.locator('.era-name span').nth(1)).toHaveCSS('opacity', '0')
  await slider.press('Shift+ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '2007')
  await slider.press('Shift+ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '2026')
  await page.keyboard.press('m'); expect((await study(page)).muted).toBe(true)
  await page.keyboard.press('h')
  await expect(page.locator('.timeline')).toHaveCSS('opacity', '0')
  expect(await page.locator('.timeline').evaluate((node: HTMLElement) => node.inert)).toBe(true)
  await page.keyboard.press('Escape')
  await expect(page.locator('.timeline')).toHaveCSS('opacity', '1')
})

test('reduced motion shows only exact eras and fades one object without moving or stretching', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' }); await ready(page)
  await page.getByRole('slider').focus()
  for (let i = 0; i < 21; i++) await page.keyboard.press('ArrowRight')
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  expect((await study(page)).renderedEra).toBe(1)
  expect((await study(page)).year).toBe(1986)
  await page.getByRole('switch').press('Enter')
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
  expect((await study(page)).renderedPosition).toBe(1)
  expect((await study(page)).stretch).toBe(1)
  await expect(page.locator('#object')).toHaveCSS('opacity', '1')
  await era(page, '3')
  expect((await study(page)).renderedEra).toBe(2)
  await page.waitForFunction(() => !!(window as any).gsap)
  await page.keyboard.press('r')
  await expect.poll(async () => (await study(page)).loopTime, { intervals: [20] }).toBeGreaterThan(1.7)
  await page.keyboard.press('r')
  await expect.poll(async () => (await study(page)).rafActive).toBe(false)
})

test('15.6 second recording returns cleanly with one hesitation and exactly eight committed flips', async ({ page }, info) => {
  await ready(page)
  await page.waitForFunction(() => !!(window as any).gsap)
  await page.evaluate(() => {
    (window as any).flips = []
    document.addEventListener('switch:flip', (e: any) => (window as any).flips.push(e.detail))
    ;(window as any).loopSamples = []
    const start = performance.now()
    function sample() {
      ;(window as any).loopSamples.push((window as any).switchStudy.state)
      if (performance.now() - start < 16000) requestAnimationFrame(sample)
    }
    requestAnimationFrame(sample)
  })
  await page.keyboard.press('r')
  await expect.poll(async () => (await study(page)).loopTime, { timeout: 17000, intervals: [100] }).toBeGreaterThan(15.15)
  expect((await study(page)).year).toBe(1965)
  expect((await study(page)).on).toBe(false)
  expect(await page.evaluate(() => (window as any).flips.length)).toBe(8)
  await expect.poll(async () => (await study(page)).loopTime, { timeout: 1000, intervals: [20] }).toBeLessThan(.4)
  await page.keyboard.press('r')
  const samples = await page.evaluate(() => (window as any).loopSamples as any[])
  expect(samples.some(s => s.loopTime > 1.5 && s.loopTime < 1.65 && s.pos < .56 && s.on)).toBe(true)
  expect(samples.some(s => s.loopTime > 1.95 && s.loopTime < 2.15 && s.pos > .95 && s.on)).toBe(true)
  expect(samples.some(s => s.loopTime > 4.8 && s.loopTime < 5.3 && s.year === 1986)).toBe(true)
  await page.screenshot({ path: info.outputPath('loop-return.png') })
})

test('cold first frame survives blocked CDN and fonts; mobile and 5K remain centered', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.route(/fonts\.gstatic\.com|cdnjs\.cloudflare\.com/, route => route.abort())
  await page.goto('/switch/index.html')
  await expect(page.getByRole('heading')).toBeVisible()
  await expect(page.getByRole('switch')).toBeVisible()
  await page.screenshot({ path: info.outputPath('phone-no-js-first-frame.png') })
  await page.setViewportSize({ width: 5120, height: 2880 })
  const frame = (await page.locator('.frame').boundingBox())!
  expect(frame.width / frame.height).toBeCloseTo(.8)
  expect(frame.x + frame.width / 2).toBeCloseTo(2560)
  await page.screenshot({ path: info.outputPath('5k-first-frame.png') })
  await context.close()
})
