<script setup lang="ts">
import { INITIAL_VALUE, ledScale, printedScale, ringScale, yearTicks } from '~/lib/morph.mjs'

const root = ref<HTMLElement | null>(null)
const { $createDialController } = useNuxtApp()
let dispose: (() => void) | undefined
onMounted(() => {
  if (root.value) dispose = $createDialController(root.value)
})
onBeforeUnmount(() => dispose?.())
</script>

<template>
  <main ref="root" class="frame relative isolate aspect-[4/5] bg-ink" aria-label="The Life of a Dial">
    <h1 class="object-title absolute font-sans">The life of a dial</h1>
    <div
      class="instrument absolute touch-none select-none outline-none"
      role="slider" tabindex="0" aria-label="Rotary control" aria-valuemin="0" aria-valuemax="100"
      :aria-valuenow="INITIAL_VALUE" aria-valuetext="30, potentiometer"
      aria-describedby="dial-instructions" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight Home End"
    >
      <div class="anatomy absolute inset-0 pointer-events-none" aria-hidden="true">
        <!-- One object: plate, depth, material, rim, mark, scale. There are no era wrappers. -->
        <svg class="surface plate" viewBox="0 0 640 640" data-plate>
          <defs>
            <linearGradient id="aluminium" x1="0" y1="0" x2=".9" y2="1"><stop stop-color="#b6b7b2" /><stop offset=".45" stop-color="#a6a7a2" /><stop offset="1" stop-color="#969892" /></linearGradient>
            <pattern id="brush" width="173" height="19" patternUnits="userSpaceOnUse"><path d="M0 1h173M12 4h124M0 8h98M42 11h131M0 15h173M8 18h128" stroke="#fff" stroke-opacity=".12" stroke-width=".5" /><path d="M0 3h83M30 7h143M0 13h163M65 17h108" stroke="#242723" stroke-opacity=".14" stroke-width=".5" /></pattern>
          </defs>
          <rect x="16" y="16" width="608" height="608" rx="5" fill="url(#aluminium)" />
          <rect x="16.5" y="16.5" width="607" height="607" rx="4.5" fill="url(#brush)" stroke="#d0d1ca" stroke-opacity=".55" />
          <g v-for="screw in [[42,42,-22],[598,42,31],[42,598,17],[598,598,-35]]" :key="`${screw[0]}-${screw[1]}`" :transform="`translate(${screw[0]} ${screw[1]}) rotate(${screw[2]})`"><circle r="6" fill="#898c85" stroke="#c2c4bc" stroke-width="1" /><path d="M-3.5 0h7" stroke="#51544e" stroke-width="1.3" /><path d="M-3.5 1h7" stroke="#cacbc6" stroke-width=".65" /></g>
        </svg>
        <div class="contact-shadow" data-shadow />
        <div class="well" data-well />
        <div class="body-shape" data-body>
          <div class="body-mass" />
          <div class="cap-collar" data-collar />
          <div class="cap" data-cap>
            <div class="metal-base" data-material />
            <div class="specular" data-specular />
            <div class="grain-rotor" data-grain-rotor>
              <div class="grain" data-grain />
              <div class="lathe" data-lathe />
            </div>
          </div>
        </div>
        <svg class="surface edge-and-scale" viewBox="0 0 640 640">
          <defs>
            <mask id="bevel-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="640" height="640">
              <circle data-bevel-mask cx="320" cy="320" r="204" fill="none" stroke="white" stroke-width="12" pathLength="360" stroke-dasharray="360 360" transform="rotate(135 320 320)" />
            </mask>
            <mask id="knurl-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="420" height="420"><circle cx="210" cy="210" r="208" fill="white" /><circle cx="210" cy="210" r="187" fill="black" /></mask>
            <g id="ridge-profile" transform="translate(210 2.5)">
              <g data-ridge-amplitude><path d="M0 0v17.5" stroke="#080909" stroke-width="1.6" /><path d="M2.35 .5v16.5" stroke="#4b4d4b" stroke-opacity=".55" stroke-width=".75" /></g>
            </g>
            <pattern id="knurl" width="420" height="420" patternUnits="userSpaceOnUse">
              <use v-for="i in 168" :key="i" href="#ridge-profile" :transform="`rotate(${(i - 1) * 360 / 168} 210 210)`" />
            </pattern>
            <clipPath id="right-half"><rect x="320" y="0" width="320" height="640" /></clipPath>
          </defs>
          <g data-edge class="svg-centered">
            <circle data-rim cx="320" cy="320" r="204" fill="none" stroke="#080909" stroke-width="12" pathLength="360" stroke-dasharray="360 360" transform="rotate(135 320 320)" />
            <g mask="url(#bevel-mask)" data-chrome opacity="0"><foreignObject x="100" y="100" width="440" height="440"><div xmlns="http://www.w3.org/1999/xhtml" class="chrome-material" /></foreignObject></g>
          </g>
          <g data-knurl-rotor class="svg-centered" style="transform:rotate(-54deg)">
            <g data-knurl transform="translate(110 110)" mask="url(#knurl-mask)"><circle cx="210" cy="210" r="207.5" fill="#242624" /><circle cx="210" cy="210" r="208" fill="url(#knurl)" /></g>
          </g>
          <g v-for="mark in printedScale" :key="`print-${mark.i}`" data-printed>
            <line :x1="mark.from.x" :y1="mark.from.y" :x2="mark.to.x" :y2="mark.to.y" stroke="#3e423b" :stroke-width="mark.major ? 1.65 : .8" :stroke-opacity="mark.major ? .76 : .56" />
            <text v-if="mark.major" :x="mark.label.x + (mark.i / 5 % 2 ? .2 : -.3)" :y="mark.label.y" fill="#41453e" :fill-opacity="mark.i / 5 % 3 ? .8 : .71" text-anchor="middle" dominant-baseline="central" font-size="17">{{ mark.i / 5 }}</text>
          </g>
          <g v-for="led in ledScale" :key="`led-${led.i}`" data-led-scale opacity="0">
            <circle :cx="led.x" :cy="led.y" r="3.1" fill="#262625" stroke="#050506" stroke-width="1" />
            <circle data-led :cx="led.x" :cy="led.y" r="2.3" fill="#f4e4bd" :opacity="led.i <= 6 ? 1 : 0" />
          </g>
          <g v-for="tick in ringScale" :key="`tick-${tick.i}`" data-tick-scale opacity="0">
            <line class="hairline" :x1="tick.from.x" :y1="tick.from.y" :x2="tick.to.x" :y2="tick.to.y" stroke="#3c3c40" stroke-width="1" />
            <line data-tick class="hairline" :x1="tick.from.x" :y1="tick.from.y" :x2="tick.to.x" :y2="tick.to.y" stroke="#F2F2F2" stroke-width="1" opacity="0" />
          </g>
          <g data-active-arc opacity="0">
            <g transform="rotate(-135 320 320)"><g clip-path="url(#right-half)"><g data-arc-a class="svg-centered" style="transform:rotate(-99deg)"><path class="hairline" d="M320 110 A210 210 0 0 1 320 530" fill="none" stroke="#F2F2F2" stroke-width="2" /></g></g></g>
            <g transform="rotate(45 320 320)"><g clip-path="url(#right-half)"><g data-arc-b class="svg-centered" opacity="0" style="transform:rotate(-180deg)"><path class="hairline" d="M320 110 A210 210 0 0 1 320 530" fill="none" stroke="#F2F2F2" stroke-width="2" /></g></g></g>
          </g>
          <g data-pointer-rotor class="svg-centered" style="transform:rotate(-54deg)">
            <g data-pointer-position transform="translate(320 167)">
              <g data-pointer-length>
                <line data-pointer-shadow x1="0" y1="-19" x2="0" y2="19" stroke="#080909" stroke-width="6" stroke-linecap="round" vector-effect="non-scaling-stroke" />
                <line data-pointer x1="0" y1="-19" x2="0" y2="19" stroke="#e4e4dc" stroke-width="3.5" stroke-linecap="round" vector-effect="non-scaling-stroke" />
              </g>
            </g>
          </g>
        </svg>
        <div class="readout-position"><div class="readout-material" data-readout><div data-idle><RollingDigits :value="INITIAL_VALUE" data-value-digits /></div></div></div>
      </div>
      <span class="focus-cue" aria-hidden="true" />
    </div>
    <section class="time-section absolute" aria-label="Time machine" data-controls>
      <div
        class="time-control relative touch-none select-none outline-none"
        role="slider" tabindex="0" aria-label="Year" aria-valuemin="1974" aria-valuemax="2026"
        aria-valuenow="1974" aria-valuetext="1974, potentiometer" aria-describedby="time-instructions"
      >
        <svg class="timeline-ruler absolute w-full" viewBox="0 0 648 88" preserveAspectRatio="none" aria-hidden="true">
          <path class="hairline" d="M0 20H648" stroke="#2A2A2D" stroke-width="1" />
          <g v-for="tick in yearTicks" :key="tick.year">
            <path class="hairline" :d="`M${tick.x} 30v${tick.height}`" :stroke="tick.major ? '#747479' : tick.decade ? '#505055' : '#2A2A2D'" stroke-width="1" />
            <path data-year-tick class="hairline" :d="`M${tick.x} 30v${tick.height}`" stroke="#F2F2F2" stroke-width="1" :opacity="tick.year === 1974 ? .65 : 0" />
          </g>
        </svg>
        <span v-for="tick in yearTicks.filter(tick => tick.labeled)" :key="tick.year" class="year-label absolute font-mono tabular-nums" :class="{ 'era-year': tick.major }" :style="{ left: `${tick.x / 648 * 100}%` }" aria-hidden="true">{{ tick.year }}</span>
        <div class="time-position absolute inset-0 pointer-events-none" data-time-position>
          <div class="year-readout font-mono tabular-nums"><RollingDigits :value="1974" :places="4" data-year-digits /></div>
          <span class="time-thumb" data-thumb />
        </div>
      </div>
    </section>
    <p id="dial-instructions" class="sr-only">Turn around the dial or drag vertically from its center. Scroll or use arrow keys to adjust by one. Shift and an arrow adjust by ten. Home and End set the limits.</p>
    <p id="time-instructions" class="sr-only">Drag the timeline to change year. Arrow keys adjust by one year. Shift and an arrow jump to the next era. R starts or stops the 17.6 second recording loop. H hides the timeline and cursor. M toggles sound. Keys 1, 2 and 3 select 1974, 2011 and 2026.</p>
    <p class="sr-only" role="status" aria-live="polite" data-status />
  </main>
</template>
