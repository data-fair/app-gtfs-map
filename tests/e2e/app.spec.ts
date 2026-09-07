import { expect, test } from '@playwright/test'
import { mockApp } from './fixtures'

test.describe('app-gtfs-map', () => {
  test('résout la famille de jeux liés, affiche le réseau et les véhicules', async ({ page }) => {
    await mockApp(page, { vehicles: 2 })
    await page.goto('/')

    // la carte est rendue avec son canvas
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })

    // overlay : titre du réseau et commandes de couches
    const overlay = page.locator('.map-overlay')
    await expect(overlay).toBeVisible()
    await expect(overlay.getByText('Réseau Test')).toBeVisible()
    await expect(overlay.getByText('Lignes', { exact: true })).toBeVisible()
    await expect(overlay.getByText('Arrêts', { exact: true })).toBeVisible()

    // les 2 lignes du réseau sont listées avec leur badge
    await expect(overlay.locator('.route-item')).toHaveCount(2)

    // les véhicules du flux temps réel sont comptés
    await expect(overlay.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })

    // la capture data-fair est déclenchée une fois carte + véhicules rendus
    await expect.poll(() => page.evaluate(() => (window as any).__captureCalled)).toBe(true)
  })

  test('signale une configuration inexploitable sans jeu lié « tracés » ni « arrêts »', async ({ page }) => {
    await mockApp(page, { withoutRelated: true, withoutRealtime: true })
    await page.goto('/')

    // le contrôle positif est le test précédent : ici l'état d'erreur doit être visible
    await expect(page.getByText(/Aucun jeu lié/)).toBeVisible({ timeout: 10000 })
  })

  test('affiche la carte sans couche véhicules quand le flux est absent', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const overlay = page.locator('.map-overlay')
    await expect(overlay).toBeVisible()
    // pas de toggle ni de statut temps réel sans flux
    await expect(overlay.getByText('Véhicules en temps réel')).toHaveCount(0)
    // la carte reste utilisable (canvas rendu) — contrôle positif du test précédent
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
  })
})
