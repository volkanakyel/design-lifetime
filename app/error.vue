<script setup lang="ts">
import type { NuxtError } from '#app'

defineProps<{ error: NuxtError }>()
</script>

<template>
  <main class="recovery">
    <h1>{{ error.statusCode === 404 ? 'Page not found.' : 'The dial couldn’t start.' }}</h1>
    <a href="/">{{ error.statusCode === 404 ? 'Back to the dial' : 'Reload to try again' }}</a>
  </main>
</template>

<style scoped>
.recovery { display: grid; place-content: center; gap: 24px; width: 100vw; min-height: 100svh; padding: 24px; text-align: center; }
h1 { margin: 0; color: #d5d5d5; font-size: clamp(24px, 4vw, 38px); font-weight: 400; letter-spacing: -.04em; }
a { justify-self: center; padding: 12px; color: #929292; font-size: 14px; text-underline-offset: 5px; }
a:hover, a:focus-visible { color: #f2f2f2; }
a:focus-visible { outline: 1px solid #ff5a1f; outline-offset: 4px; }
</style>
