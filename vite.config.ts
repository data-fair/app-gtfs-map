import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
import vuetify, { transformAssetUrls } from 'vite-plugin-vuetify'
import vueI18n from '@intlify/unplugin-vue-i18n/vite'
import { settingsPath } from '@data-fair/lib-vuetify/vite.js'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const port = Number(env.APP_PORT ?? 3000)
  return {
    base: env.PUBLIC_URL ?? '/app/',
    plugins: [
      vue({ template: { transformAssetUrls } }),
      vueI18n({}),
      vuetify({ autoImport: true, styles: { configFile: settingsPath } })
    ],
    resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
    server: {
      port,
      strictPort: !!env.APP_PORT,
      // hmr suit le port du serveur : un websocket resté sur 3000 fait tenir deux
      // ports à l'application et annule le décalage
      hmr: { port, protocol: 'ws' },
      warmup: { clientFiles: ['./src/main.ts', './src/**/*.vue'] }
    }
  }
})
