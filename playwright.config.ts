import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.E2E_PORT ?? 3100)
const BASE_URL = `http://localhost:${PORT}`

// webServer is global to the config: skip it on a unit-only run (rather than splitting the
// config in two files). Playwright accepts `--project x` and `--project=x`: read both forms.
const selectedProjects = process.argv.flatMap((arg, i) => {
  if (arg === '--project') return [process.argv[i + 1]]
  if (arg.startsWith('--project=')) return [arg.slice('--project='.length)]
  return []
})
const isUnitOnly = selectedProjects.length > 0 && selectedProjects.every(p => p === 'unit')

export default defineConfig({
  testMatch: /.*\.spec\.ts$/,
  forbidOnly: !!process.env.CI,
  // e2e on a single worker: under contention (dev server, SwiftShader) parallel runs give false failures that change at each run
  workers: isUnitOnly ? undefined : 1,
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
        env: { ...process.env, APP_PORT: String(PORT) },
        reuseExistingServer: !process.env.CI
      }
})
