import { expect, test } from '@playwright/test'
import { mockApp } from './fixtures'

test.describe('app-gtfs-map', () => {
  test('résout la famille de jeux liés, affiche le réseau et les véhicules', async ({ page }) => {
    await mockApp(page, { vehicles: 2 })
    await page.goto('/')

    // la carte est rendue avec son canvas
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })

    // overlay : titre du réseau, sans commande d'affichage des couches
    // (tracés, arrêts et labels sont toujours affichés, plus aucun switch)
    const overlay = page.locator('.map-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay.getByText('Réseau Test')).toBeVisible()
    await expect(overlay.locator('.v-switch')).toHaveCount(0)

    // les 2 lignes du réseau sont listées avec leur badge
    await expect(overlay.locator('.route-item')).toHaveCount(2)

    // les véhicules du flux temps réel sont comptés
    await expect(overlay.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })

    // la capture data-fair est déclenchée une fois carte + véhicules rendus
    await expect.poll(() => page.evaluate(() => (window as any).__captureCalled)).toBe(true)
  })

  test('déclenche la capture seulement après le rendu des couches', async ({ page }) => {
    await mockApp(page, { shapesDelayMs: 800 })
    await page.goto('/')

    await expect.poll(() => page.evaluate(() => (window as any).__captureCalled)).toBe(true)
    const { captureAt, shapesAt } = await page.evaluate(() => ({
      captureAt: (window as any).__captureAt as number,
      shapesAt: (window as any).__shapesAt as number
    }))
    // contrôle négatif : sans l'attente des couches, la capture part avant la réponse des tracés
    expect(shapesAt).toBeGreaterThan(0)
    expect(captureAt).toBeGreaterThanOrEqual(shapesAt)
  })

  test('signale une configuration inexploitable sans jeu lié « tracés » ni « arrêts »', async ({ page }) => {
    await mockApp(page, { withoutRelated: true, withoutRealtime: true })
    await page.goto('/')

    // le contrôle positif est le test précédent : ici l'état d'erreur doit être visible
    await expect(page.getByText(/Aucun jeu lié/)).toBeVisible({ timeout: 10000 })
  })

  test('affiche la carte sans statut temps réel quand le flux est absent', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const overlay = page.locator('.map-overlay')
    await expect(overlay).toBeVisible()
    // pas de statut temps réel sans flux (contrôle positif : le compteur apparaît avec flux)
    await expect(overlay.locator('.rt-status')).toHaveCount(0)
    // la carte reste utilisable (canvas rendu)
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
  })

  test('restaure la position et la ligne sélectionnée depuis l\'URL', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/?lng=-1.53&lat=47.205&zoom=12&route=A')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    // la vue de l'URL doit survivre à l'arrivée des tracés (sinon fitNetwork la réécrase)
    await expect(page.locator('.route-item')).toHaveCount(2)

    const view = await page.evaluate(() => {
      const m = window.__MAP__
      return m ? { lng: m.getCenter().lng, lat: m.getCenter().lat, zoom: m.getZoom() } : null
    })
    expect(view).not.toBeNull()
    expect(view!.lng).toBeCloseTo(-1.53, 5)
    expect(view!.lat).toBeCloseTo(47.205, 5)
    expect(view!.zoom).toBeCloseTo(12, 2)

    // la ligne restaurée est marquée sélectionnée dans l'overlay
    await expect(page.locator('.route-item.selected')).toHaveCount(1)
    await expect(page.locator('.route-item.selected .route-badge')).toContainText('1')
  })

  test('reporte la navigation dans l\'URL, restaurée après rechargement', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    // déplacement programmatique : moveend doit écrire lng/lat/zoom dans l'URL
    await page.evaluate(() => window.__MAP__!.jumpTo({ center: [-1.54, 47.2], zoom: 13 }))
    await expect.poll(() => page.evaluate(() => {
      const params = new URLSearchParams(window.location.search)
      return {
        lng: Number(params.get('lng')),
        lat: Number(params.get('lat')),
        zoom: Number(params.get('zoom'))
      }
    })).toEqual({ lng: -1.54, lat: 47.2, zoom: 13 })

    // rechargement : la vue naviguée est reprise, pas le cadrage réseau
    await page.reload()
    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    const view = await page.evaluate(() => {
      const m = window.__MAP__
      return m ? { lng: m.getCenter().lng, lat: m.getCenter().lat, zoom: m.getZoom() } : null
    })
    expect(view).not.toBeNull()
    expect(view!.lng).toBeCloseTo(-1.54, 5)
    expect(view!.lat).toBeCloseTo(47.2, 5)
    expect(view!.zoom).toBeCloseTo(13, 2)
  })
})
