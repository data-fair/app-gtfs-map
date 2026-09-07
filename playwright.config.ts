import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = `http://localhost:${PORT}`

// webServer est global à la config : le conditionner pour ne pas lancer Vite sur un run
// purement unitaire (plutôt que de scinder en deux fichiers). Playwright accepte `--project x`
// et `--project=x` : les deux formes doivent être lues.
const selectedProjects = process.argv.flatMap((arg, i) => {
  if (arg === '--project') return [process.argv[i + 1]]
  if (arg.startsWith('--project=')) return [arg.slice('--project='.length)]
  return []
})
const isUnitOnly = selectedProjects.length > 0 && selectedProjects.every(p => p === 'unit')

export default defineConfig({
  testMatch: /.*\.spec\.ts$/,
  forbidOnly: !!process.env.CI,
  outputDir: './tests/output',
  use: { baseURL: BASE_URL },
  projects: [
    { name: 'unit', testDir: './tests/unit' },
    { name: 'e2e', testDir: './tests/e2e', use: { ...devices['Desktop Chrome'] } }
  ],
  webServer: isUnitOnly
    ? undefined
    : {
        command: 'PUBLIC_URL= npm run dev-app',
        url: BASE_URL,
        env: { ...process.env, APP_PORT: String(PORT), DATA_FAIR_TEST: 'true' },
        reuseExistingServer: !process.env.CI
      }
})
