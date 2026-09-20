import { expect, type Page } from '@playwright/test'
import { mockApp, test } from './fixtures'

/**
 * Clique sur la carte aux coordonnées géographiques données.
 * `empty: true` pour un clic volontairement dans le vide (désélection).
 */
async function clickMapAt (page: Page, lngLat: [number, number], { empty = false }: { empty?: boolean } = {}) {
  if (empty) {
    await page.waitForFunction(() => window.__MAP__!.loaded())
  } else {
    // les sources GeoJSON sont taillées et rendues de façon asynchrone : sans cette
    // attente, queryRenderedFeatures peut ne rien trouver et le clic est pris pour
    // un clic dans le vide (détail jamais ouvert) — instabilité observée sous charge
    await expect.poll(() => page.evaluate(([lng, lat]) => {
      const m = window.__MAP__!
      return m.queryRenderedFeatures(m.project([lng, lat])).length
    }, lngLat), { timeout: 15000 }).toBeGreaterThan(0)
  }
  const box = (await page.locator('.maplibregl-canvas').boundingBox())!
  const point = await page.evaluate(([lng, lat]) => {
    const p = window.__MAP__!.project([lng, lat])
    return { x: p.x, y: p.y }
  }, lngLat)
  await page.mouse.click(box.x + point.x, box.y + point.y)
}

test.describe('app-gtfs-map', () => {
  test('résout la famille de jeux liés, affiche le réseau et les véhicules', async ({ page }) => {
    await mockApp(page, { vehicles: 2 })
    await page.goto('/')

    // la carte est rendue avec son canvas
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })

    // panneau latéral : titre du réseau, sans commande d'affichage des couches
    // (tracés, arrêts et labels sont toujours affichés, plus aucun switch)
    const panel = page.locator('.navigation-side')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Réseau Test')).toBeVisible()
    await expect(panel.locator('.v-switch')).toHaveCount(0)

    // les 2 lignes du réseau sont listées avec leur badge
    await expect(panel.locator('.route-item')).toHaveCount(2)

    // les véhicules du flux temps réel sont comptés
    await expect(panel.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })

    // par défaut le panneau est à droite : la carte occupe le bord gauche
    const panelBox = (await panel.boundingBox())!
    const canvasBox = (await page.locator('.maplibregl-canvas').boundingBox())!
    expect(canvasBox.x).toBe(0)
    expect(panelBox.x).toBeGreaterThan(canvasBox.x)

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

    const panel = page.locator('.navigation-side')
    await expect(panel).toBeVisible()
    // pas de statut temps réel sans flux (contrôle positif : le compteur apparaît avec flux)
    await expect(panel.locator('.rt-status')).toHaveCount(0)
    // la carte reste utilisable (canvas rendu)
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
  })

  test('signale un flux GTFS-RT sans positions de véhicules (TripUpdate)', async ({ page }) => {
    await mockApp(page, { feedKind: 'tripUpdate' })
    await page.goto('/')

    // le flux est bien récupéré mais inexploitable : l'utilisateur doit comprendre pourquoi
    const panel = page.locator('.navigation-side')
    await expect(panel.getByText(/TripUpdate/)).toBeVisible({ timeout: 10000 })

    // la capture est déclenchée sans attendre de véhicules (contrôle positif : le premier test)
    await expect.poll(() => page.evaluate(() => (window as any).__captureCalled)).toBe(true)
  })

  test('signale un flux GTFS-RT vide', async ({ page }) => {
    await mockApp(page, { feedKind: 'empty' })
    await page.goto('/')

    const panel = page.locator('.navigation-side')
    await expect(panel.getByText(/aucun véhicule/)).toBeVisible({ timeout: 10000 })
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

    // la ligne restaurée est marquée sélectionnée dans la légende
    await expect(page.locator('.route-item.selected')).toHaveCount(1)
    await expect(page.locator('.route-item.selected .route-badge')).toContainText('1')

    // et son détail est ouvert dans la section Sélection
    await expect(page.locator('.navigation-side').getByText('Ligne 1')).toBeVisible()
    await expect(page.locator('.navigation-side').getByText('Gare - Plage')).toBeVisible()
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

  test('le clic dans la légende filtre la carte et ouvre le détail de la ligne', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    // le clic légende filtre les tracés sur la ligne choisie
    await panel.locator('.route-item').first().click()
    await expect(panel.getByText('Ligne 1')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines')))
      .toEqual(['==', ['get', 'route_id'], 'A'])
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-vehicles-circle')))
      .toEqual(['==', ['get', 'routeId'], 'A'])

    // re-clic : la ligne est désélectionnée, le filtre levé et le détail refermé
    await panel.locator('.route-item').first().click()
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines'))).toBe(true)
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-vehicles-circle'))).toBe(true)
    await expect(panel.getByText('Ligne 1')).toBeHidden()
  })

  test('le filtre de ligne restreint les véhicules et le compteur de la légende', async ({ page }) => {
    await mockApp(page, { vehicles: 2 })
    await page.goto('/')

    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await expect(panel.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })

    // un véhicule par ligne dans le flux mocké : la ligne 1 n'en compte plus qu'un
    await panel.locator('.route-item').first().click()
    await expect(panel.getByText(/1 véhicule/)).toBeVisible({ timeout: 10000 })

    await panel.locator('.route-item').first().click()
    await expect(panel.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })
  })

  test('la configuration peut restreindre l\'affichage à une sélection de lignes', async ({ page }) => {
    await mockApp(page, { vehicles: 2, config: { routes: { mode: 'include', ids: ['A'] } } })
    await page.goto('/')

    const panel = page.locator('.navigation-side')
    // seule la ligne 1 est listée et seuls ses véhicules sont comptés
    await expect(panel.locator('.route-item')).toHaveCount(1, { timeout: 15000 })
    await expect(panel.locator('.route-item .route-badge')).toContainText('1')
    await expect(panel.getByText(/1 véhicule/)).toBeVisible({ timeout: 10000 })

    // un arrêt desservi par les deux lignes ne montre que le badge autorisé
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await expect(panel.locator('.gtfs-details .route-badge')).toHaveCount(1)
  })

  test('la configuration peut masquer une sélection de lignes', async ({ page }) => {
    await mockApp(page, { vehicles: 2, config: { routes: { mode: 'exclude', ids: ['A'] } } })
    await page.goto('/')

    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(1, { timeout: 15000 })
    await expect(panel.locator('.route-item .route-badge')).toContainText('2')
    await expect(panel.getByText(/1 véhicule/)).toBeVisible({ timeout: 10000 })
  })

  test('le clic sur une ligne de la carte ouvre le détail sans filtrer', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    await clickMapAt(page, [-1.53, 47.21])
    await expect(panel.getByText('Ligne 1')).toBeVisible()

    // aucun filtre appliqué par un clic carte
    const filter = await page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines'))
    expect(filter).toBe(true)

    // clic sur la carte vide : le détail est refermé
    await clickMapAt(page, [-1.5, 47.18], { empty: true })
    await expect(panel.getByText('Ligne 1')).toBeHidden()
  })

  test('le clic sur un arrêt affiche son détail', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    // routes reçues en tableau par l'API GeoJSON : les deux badges de ligne sont rendus
    await expect(panel.locator('.gtfs-details .route-badge')).toHaveCount(2)
  })

  test('mobile : bottom nav pour la légende et le détail', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    const nav = page.locator('.v-bottom-navigation')
    await expect(nav).toBeVisible()
    await expect(page.locator('.navigation-side')).toHaveCount(0)

    // la carte laisse la place à la barre de navigation (56 px)
    const canvasBox = (await page.locator('.maplibregl-canvas').boundingBox())!
    expect(Math.round(canvasBox.height)).toBe(800 - 56)

    // la feuille s'ouvre sur la légende au clic sur l'onglet
    await nav.getByRole('button', { name: 'Légende' }).click()
    await expect(page.locator('.route-item')).toHaveCount(2)

    // le clic sur une ligne bascule sur l'onglet Sélection et ouvre le détail
    await page.locator('.route-item').first().click()
    await expect(page.locator('.v-bottom-sheet').getByText('Ligne 1')).toBeVisible()
  })

  test('positionne le panneau à gauche quand panelPosition vaut left', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true, config: { panelPosition: 'left' } })
    await page.goto('/')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    const panelBox = (await page.locator('.navigation-side').boundingBox())!
    const canvasBox = (await page.locator('.maplibregl-canvas').boundingBox())!
    expect(panelBox.x).toBe(0)
    expect(canvasBox.x).toBeGreaterThan(panelBox.x)
  })

  test('pré-remplit realtime.url depuis le lien public de la pièce jointe GTFS-RT', async ({ page }) => {
    await mockApp(page)

    // page parente jouant le rôle de data-fair en mode brouillon : dans une iframe
    // window.parent !== window, donc l'app poste réellement ses mises à jour de config
    await page.route('**/draft-parent*', route => route.fulfill({
      contentType: 'text/html',
      body: '<!DOCTYPE html><html><body><iframe src="/" style="width:100%;height:100vh;border:0"></iframe></body></html>'
    }))
    await page.addInitScript(() => {
      ;(window as any).__setConfigs = []
      window.addEventListener('message', (event) => {
        if ((event.data as any)?.type === 'set-config') (window as any).__setConfigs.push(event.data.content)
      })
    })
    await page.goto('/draft-parent')

    // le lien public de la pièce jointe est poussé dans la configuration
    await expect.poll(() => page.evaluate(() =>
      ((window as any).__setConfigs as any[]).find(c => c.field === 'realtime.url')?.value
    )).toBe('/api/v1/datasets/gtfs-meta/metadata-attachments/gtfs-rt.protobuf')

    // la famille de jeux liés est poussée en même temps : sans le correctif DataCloneError
    // l'exception interrompait resolve() avant ces deux messages
    const datasets = await page.evaluate(() =>
      ((window as any).__setConfigs as any[]).find(c => c.field === 'datasets')?.value?.map((d: any) => d.id)
    )
    expect(datasets).toEqual(['gtfs-meta', 'gtfs-shapes', 'gtfs-stops', 'gtfs-stoptimes'])
  })
})
