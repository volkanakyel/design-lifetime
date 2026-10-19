import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { gzipSync, gunzipSync, brotliDecompressSync } from 'node:zlib'

const output = path.resolve('.output/public')
assert.ok(fs.existsSync(path.join(output, 'index.html')), 'Run pnpm build before production checks.')
const html = fs.readFileSync(path.join(output, 'index.html'), 'utf8')
const head = html.split('</head>')[0]
const tags = (source, name) => [...source.matchAll(new RegExp(`<${name}\\b[^>]*>`, 'g'))].map(match => match[0])
const attribute = (tag, name) => tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1]
const links = tags(head, 'link')
const modules = tags(html, 'script').filter(tag => attribute(tag, 'type') === 'module').map(tag => attribute(tag, 'src'))
const css = [...head.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n')

function asset(url) {
  assert.ok(url?.startsWith('/') && !url.startsWith('//'), `Expected local asset: ${url}`)
  const file = path.resolve(output, `.${url}`)
  assert.ok(file.startsWith(`${output}${path.sep}`), 'Asset must remain within public output')
  assert.ok(fs.existsSync(file), `Missing asset: ${url}`)
  return file
}

test('prerendered first frame includes the title, complete anatomy, and accessible controls', () => {
  assert.match(html, /<h1[^>]*>The life of a dial<\/h1>/)
  assert.match(html, /data-ssr="true"/)
  const sliders = tags(html, 'div').filter(tag => attribute(tag, 'role') === 'slider')
  assert.equal(sliders.length, 2)
  assert.deepEqual(sliders.map(tag => [attribute(tag, 'aria-label'), attribute(tag, 'aria-valuenow')]), [['Rotary control', '30'], ['Year', '1974']])
  for (const [name, count] of [['data-pointer', 1], ['data-printed', 51], ['data-led', 21], ['data-tick', 24], ['data-year-tick', 53]]) {
    assert.equal((html.match(new RegExp(`\\b${name}(?:=""|(?=[\\s>]))`, 'g')) ?? []).length, count, name)
  }
})

test('critical CSS is inline; startup has one module and no speculative or payload downloads', () => {
  assert.match(css, /\.frame\{/)
  assert.match(css, /\.object-title\{/)
  assert.ok(css.length < 14000, 'Critical styles must remain small')
  assert.equal(links.filter(tag => attribute(tag, 'rel') === 'stylesheet').length, 0)
  assert.equal(links.filter(tag => attribute(tag, 'rel') === 'prefetch').length, 0)
  assert.equal(modules.length, 1)
  assert.deepEqual(links.filter(tag => attribute(tag, 'rel') === 'modulepreload').map(tag => attribute(tag, 'href')), modules)
  assert.equal(fs.existsSync(path.join(output, '_payload.json')), false)
  assert.equal(fs.existsSync(path.join(output, '_nuxt/builds')), false)
  const bundle = fs.readFileSync(asset(modules[0]), 'utf8')
  assert.ok(bundle.includes('dial:detent'), 'Controller must ship in the initial module')
  assert.ok(bundle.includes('CustomEase'), 'Exact motion tokens must retain their GSAP easing implementation')
})

test('font preloads point to small, licensed, content-addressed local WOFF2 files', () => {
  const fonts = links.filter(tag => attribute(tag, 'as') === 'font')
  assert.equal(fonts.length, 2)
  let bytes = 0
  for (const tag of fonts) {
    const href = attribute(tag, 'href'), file = asset(href), data = fs.readFileSync(file)
    assert.equal(data.subarray(0, 4).toString(), 'wOF2')
    assert.ok(href.includes(createHash('sha256').update(data).digest('hex').slice(0, 12)))
    assert.ok(css.includes(href), 'Preload and font-face URLs must agree')
    assert.equal(attribute(tag, 'crossorigin'), 'anonymous')
    bytes += data.length
  }
  assert.ok(bytes < 24 * 1024)
  assert.equal((css.match(/font-display:optional/g) ?? []).length, 2)
  assert.match(fs.readFileSync(path.join(output, 'fonts/geist-OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/)
  assert.match(fs.readFileSync(path.join(output, 'fonts/geist-mono-OFL.txt'), 'utf8'), /SIL OPEN FONT LICENSE/)
  assert.equal(links.some(tag => /https?:\/\//.test(attribute(tag, 'href') ?? '')), false)
})

test('HTML and JavaScript ship valid gzip/Brotli assets within transfer budgets', () => {
  const files = [path.join(output, 'index.html'), ...modules.map(asset)]
  for (const file of files) {
    const raw = fs.readFileSync(file)
    assert.deepEqual(gunzipSync(fs.readFileSync(`${file}.gz`)), raw)
    assert.deepEqual(brotliDecompressSync(fs.readFileSync(`${file}.br`)), raw)
  }
  const script = fs.readFileSync(asset(modules[0]))
  assert.ok(script.length < 245000, 'Initial runtime grew beyond its raw JavaScript budget')
  assert.ok(gzipSync(script).length < 90 * 1024, 'Initial runtime grew beyond its gzip transfer budget')
  assert.ok(gzipSync(Buffer.from(html)).length < 14 * 1024, 'Prerendered document grew beyond its transfer budget')
  console.log(`Production transfer: HTML ${gzipSync(Buffer.from(html)).length} B gzip; JavaScript ${gzipSync(script).length} B gzip; ${modules.length} initial module.`)
})
