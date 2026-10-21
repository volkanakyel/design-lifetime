import tailwindcss from '@tailwindcss/vite'

export default defineNuxtConfig({
  compatibilityDate: '2026-10-19',
  devtools: { enabled: false },
  pages: false,
  features: { inlineStyles: true },
  experimental: {
    // This single-screen app has no client navigation or fetched payload to extract.
    appManifest: false,
    payloadExtraction: false,
  },
  routeRules: {
    '/': { prerender: true },
    '/switch': { redirect: '/switch/index.html' },
    '/switch/': { redirect: '/switch/index.html' },
    '/fonts/**': { headers: { 'cache-control': 'public, max-age=31536000, immutable' } },
  },
  nitro: {
    compressPublicAssets: { gzip: true, brotli: true },
    prerender: { crawlLinks: false, failOnError: true },
  },
  css: ['~/assets/css/main.css'],
  vite: {
    plugins: [tailwindcss()],
    // All application and Nuxt shell components use the Composition API.
    define: { __VUE_OPTIONS_API__: false },
  },
  app: {
    head: {
      title: 'The Life of a Dial',
      htmlAttrs: { lang: 'en' },
      meta: [
        { name: 'theme-color', content: '#0B0B0C' },
        { name: 'color-scheme', content: 'dark' },
        { name: 'description', content: 'One rotary control. Fifty-two years of touch. Scrub through the life of a dial.' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1, viewport-fit=cover' },
      ],
      link: [
        { rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' },
        { rel: 'preload', href: '/fonts/geist-latin-ba884770e9f5.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous', fetchpriority: 'high' },
        { rel: 'preload', href: '/fonts/geist-mono-latin-23840067d1dd.woff2', as: 'font', type: 'font/woff2', crossorigin: 'anonymous', fetchpriority: 'high' },
      ],
    },
  },
})
