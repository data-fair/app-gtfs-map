// Compatibilité d-frame — le shim v-iframe-compat injecté par DataFair quand
// l'app est embarquée (portail, dashboard) lit window.vIframeOptions pour
// appliquer les updateSrc du parent sans recharger l'iframe.
import { expect, test } from '@playwright/test'
import { mockApp } from './fixtures'

test.describe('compatibilité d-frame (shim v-iframe-compat)', () => {
  test('expose reactiveSearchParams au shim dès l\'évaluation du module', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    // posé au niveau module de main.ts, avant createApp : présent dès le chargement
    const exposed = await page.evaluate(() => {
      const opts = window.vIframeOptions
      return !!opts && typeof opts.reactiveParams === 'object' && opts.reactiveParams !== null
    })
    expect(exposed).toBe(true)
  })

  test('les paramètres écrits par le shim passent par la synchro d\'URL de la lib', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    // écriture telle que la ferait le shim sur updateSrc : c'est bien le singleton
    // réactif de la lib, donc le paramètre est reporté dans l'URL
    await page.evaluate(() => {
      window.vIframeOptions!.reactiveParams.route = 'B'
    })
    await expect.poll(() => page.evaluate(() =>
      new URLSearchParams(window.location.search).get('route')
    )).toBe('B')
  })
})
