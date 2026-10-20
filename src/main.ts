import '@data-fair/lib-vuetify/style/global.scss'
import { createApp } from 'vue'
import { createVuetify } from 'vuetify'
import { createI18n } from 'vue-i18n'
import { createSession } from '@data-fair/lib-vue/session.js'
import { vuetifySessionOptions } from '@data-fair/lib-vuetify'
import { createUiNotif } from '@data-fair/lib-vue/ui-notif.js'
import { createLocaleDayjs } from '@data-fair/lib-vue/locale-dayjs.js'
import reactiveSearchParams from '@data-fair/lib-vue/reactive-search-params-global.js'
import { aliases, mdi } from 'vuetify/iconsets/mdi-svg'
import App from './App.vue'
import { createConfig } from './composables/config'

// read by the v-iframe-compat shim DataFair injects (d-frame, portal/dashboard): without
// it, every parent updateSrc falls back to window.location.href → full iframe reload
// → flicker. Module level, before createApp.
window.vIframeOptions = { reactiveParams: reactiveSearchParams }

async function init () {
  // vuetifySessionOptions throws without session.site.value: the _public.js <script>
  // in index.html sets window.__PUBLIC_SITE_INFO, read without fetch; siteInfo triggers
  // the deprecated refreshSiteInfo and only remains as a fallback if the script was not served
  const session = await createSession({
    directoryUrl: '/simple-directory',
    siteInfo: !window.__PUBLIC_SITE_INFO
  })

  // createI18n AFTER the session, with the final locale.
  // fallbackLocale 'en': lib-vuetify <i18n> blocks only have fr and en, so
  // without fallback a session in another language shows raw keys.
  const i18n = createI18n({
    legacy: false,
    locale: session.lang.value,
    fallbackLocale: 'en'
  })

  const vuetify = createVuetify({
    ...vuetifySessionOptions(session),
    icons: { defaultSet: 'mdi', aliases, sets: { mdi } }
  })

  const app = createApp(App)
  app.use(vuetify)
    .use(session)
    .use(i18n)
    .use(createLocaleDayjs(session.lang.value))
    .use(createUiNotif())
    .use(createConfig())
  app.mount('#app')
}

init()
