import { createDialController } from '~/lib/controller'

// The only screen needs this controller immediately. Include it in Nuxt's initial
// module graph instead of waiting for hydration to start another download.
export default defineNuxtPlugin({
  name: 'dial-controller',
  setup() {
    return { provide: { createDialController } }
  },
})
