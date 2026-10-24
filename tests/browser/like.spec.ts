import { test, expect, type Page } from '@playwright/test'

const study = (page: Page) => page.evaluate(() => (window as any).likeStudy.state)
async function ready(page: Page) {
  await page.goto('/like')
  await page.waitForFunction(() => !!(window as any).likeStudy)
  await page.evaluate(() => {
    const w = window as any
    w.events = { toggle: [] as any[], burst: 0 }
    document.addEventListener('like:toggle', (e: any) => w.events.toggle.push(e.detail))
    document.addEventListener('like:burst', () => w.events.burst++)
  })
}
async function year(page: Page, y: number) {
  await page.evaluate(y => (window as any).likeStudy.setYear(y), y)
  await page.waitForTimeout(300)
}

test('cold first frame survives blocked CDN, fonts and JavaScript', async ({ browser }, info) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } })
  const page = await context.newPage()
  await page.route(/fonts\.gstatic\.com|cdnjs\.cloudflare\.com/, route => route.abort())
  await page.goto('/like/index.html')
  await expect(page.getByRole('heading')).toHaveText('The life of a like')
  await expect(page.getByRole('button', { name: 'Like, 41' })).toBeVisible()
  await expect(page.getByRole('slider')).toHaveAttribute('aria-valuetext', '2004, Plus one')
  await page.screenshot({ path: info.outputPath('phone-no-js-first-frame.png') })
  await context.close()
})

test('one glyph never self-intersects and every whole year is a single object', async ({ page }) => {
  await ready(page)
  const result = await page.evaluate(() => {
    const s = (window as any).likeStudy
    let minRadius = Infinity
    for (let t = 0; t <= 2.00001; t += 0.0025) minRadius = Math.min(minRadius, ...s.glyphRadii(t))
    const blends: number[] = []
    for (let y = 2004; y <= 2026; y++) {
      const g = s.anatomy(s.yearToT(y))
      // Counter layers are crossfades between typefaces: at rest exactly one is visible.
      const layers = [g.c04, g.c10, g.c16, g.c26]
      // Material switches (gloss, flat fill, ghost border, fill vs line) are resolved too.
      const switches = [g.gloss, g.gradient, g.fill, g.border, g.base, g.outline, g.one, g.underline]
      const partial = (o: number) => o > 0.001 && o < 0.999
      if (layers.some(partial) || switches.some(partial) || layers.filter((o: number) => o > 0.5).length !== 1) blends.push(y)
    }
    return { minRadius, blends }
  })
  // Radii at fixed angles that stay positive describe a star-shaped, simple polygon.
  expect(result.minRadius).toBeGreaterThan(0.15)
  expect(result.blends).toEqual([])
})

test('each era likes exactly once; 2026 hold compresses, pops once to 1.08 and rings once', async ({ page }) => {
  await ready(page)
  const like = page.locator('.like')
  await like.focus()
  await page.keyboard.press('Enter')
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await expect(like).toHaveAttribute('aria-label', 'Like, 42')
  expect((await study(page)).s).toBe(1)
  await page.keyboard.press('Enter')
  await year(page, 2010)
  await page.keyboard.press('Enter')
  await year(page, 2026)
  await page.keyboard.press('Enter')
  await expect(like).toHaveAttribute('aria-pressed', 'false')
  await page.waitForTimeout(400)

  const box = (await like.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.42)
  await page.mouse.down()
  await page.waitForTimeout(450)
  const held = await study(page)
  expect(held.q).toBeGreaterThan(0.8)
  await page.evaluate(() => {
    const w = window as any
    w.peak = 1
    const f = () => { w.peak = Math.max(w.peak, w.likeStudy.state.s); if (w.likeStudy.state.s !== 1 || w.peak === 1) requestAnimationFrame(f) }
    requestAnimationFrame(f)
  })
  await page.mouse.up()
  await page.waitForTimeout(700)
  expect(await page.evaluate(() => (window as any).peak)).toBeCloseTo(1.08, 2)
  const events = await page.evaluate(() => (window as any).events)
  expect(events.toggle.map((e: any) => [e.era, e.liked])).toEqual([[0, true], [0, false], [1, true], [2, false], [2, true]])
  expect(events.burst).toBe(1)
})

test('slider steps years, jumps eras, labels only on snap; H and M work', async ({ page }) => {
  await ready(page)
  const slider = page.getByRole('slider')
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuetext', '2005, between eras')
  await page.keyboard.press('Shift+ArrowRight')
  await expect(slider).toHaveAttribute('aria-valuenow', '2010')
  await page.waitForTimeout(300)
  await expect(page.locator('.era-name span').nth(1)).toHaveCSS('opacity', '1')
  await page.keyboard.press('End')
  await expect(slider).toHaveAttribute('aria-valuetext', '2026, Heart')
  await page.keyboard.press('h')
  expect(await page.locator('.timeline').evaluate((node: HTMLElement) => node.inert)).toBe(true)
  await page.keyboard.press('m')
  await expect(page.locator('#mute')).toHaveAttribute('aria-pressed', 'true')
})

test('reduced motion: no squash or burst, like is a crossfade', async ({ browser }) => {
  const context = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 1080, height: 1350 } })
  const page = await context.newPage()
  await ready(page)
  await year(page, 2026)
  const like = page.locator('.like')
  const box = (await like.boundingBox())!
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.42)
  await page.mouse.down()
  await page.waitForTimeout(300)
  expect((await study(page)).q).toBe(0)
  await page.mouse.up()
  await page.waitForTimeout(300)
  expect((await study(page)).s).toBe(1)
  expect(await page.evaluate(() => (window as any).events.burst)).toBe(0)
  await expect(like).toHaveAttribute('aria-pressed', 'true')
  await context.close()
})

test('recording loop: eight likes, two bursts, back to an unliked 2004', async ({ page }) => {
  await ready(page)
  await page.keyboard.press('r')
  await page.waitForTimeout(15_000)
  const events = await page.evaluate(() => (window as any).events)
  expect(events.toggle).toHaveLength(8)
  expect(events.burst).toBe(2)
  const s = await study(page)
  expect(s.liked).toBe(false)
  expect(s.year).toBe(2004)
  await page.keyboard.press('Escape')
})
