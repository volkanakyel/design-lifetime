<script setup lang="ts">
const props = withDefaults(defineProps<{ value: number, places?: number }>(), { places: 3 })
const characters = String(props.value).padStart(props.places, ' ').split('')
const length = String(props.value).length
</script>

<template>
  <span class="rolling-digits font-mono tabular-nums" aria-hidden="true">
    <span
      v-for="(character, i) in characters"
      :key="i"
      class="digit-slot"
      :style="{ transform: `translateX(${(i - places + length / 2) * 100}%)`, opacity: character === ' ' ? 0 : 1 }"
    ><span class="glyph glyph-new">{{ character.trim() }}</span><span class="glyph glyph-old" /><span class="glyph glyph-blur" /></span>
  </span>
</template>
