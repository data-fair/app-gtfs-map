import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from '@playwright/test'

// Config dédiée au rejeu d'un enregistrement GTFS-RT : hors des projets unit/e2e,
// elle n'est pas exécutée par `npm test`. Lancement :
//   npx playwright test --config scripts/replay.config.ts
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.REPLAY_PORT ?? 3199)
const BASE_URL = `http://localhost:${PORT}`

export default defineConfig({
  testDir: './replay',
  testMatch: /.*\.spec\.ts$/,
  outputDir: path.join(REPO_ROOT, 'tests/output/replay'),
  timeout: 20 * 60 * 1000,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    viewport: { width: Number(process.env.GIF_WIDTH ?? 1200), height: Number(process.env.GIF_HEIGHT ?? 627) }
  },
  webServer: {
    command: 'PUBLIC_URL= npm run dev-app',
    cwd: REPO_ROOT,
    url: BASE_URL,
    env: { ...process.env, APP_PORT: String(PORT) },
    reuseExistingServer: !process.env.CI
  }
})
