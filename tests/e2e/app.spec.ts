import type { Page } from '@playwright/test'
import { expect, mapConsole, mockApp, test } from './fixtures'

test.use({ expectedConsole: mapConsole })

/**
 * Clicks the map at the given geographic coordinates.
 * `empty: true` for a deliberate click on empty space (deselection).
 */
async function clickMapAt (page: Page, lngLat: [number, number], { empty = false }: { empty?: boolean } = {}) {
  if (empty) {
    await page.waitForFunction(() => window.__MAP__!.loaded())
  } else {
    // GeoJSON sources are tiled and rendered asynchronously: without this wait,
    // queryRenderedFeatures may find nothing and the click is taken as a click
    // on empty space (details never open), flakiness seen under load
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
  test('resolves the family of linked datasets, shows the network and the vehicles', async ({ page }) => {
    await mockApp(page, { vehicles: 2 })
    await page.goto('/')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })

    // side panel: network title, no layer display toggle
    // (shapes, stops and labels are always shown, no switch anymore)
    const panel = page.locator('#map-panel-drawer')
    await expect(panel).toBeVisible()
    await expect(panel.getByText('Réseau Test')).toBeVisible()
    await expect(panel.locator('.v-switch')).toHaveCount(0)

    // the 2 network routes are listed with their badge
    await expect(panel.locator('.route-item')).toHaveCount(2)

    // realtime feed vehicles are counted
    await expect(panel.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })

    // panel on the right by default: the map takes the left edge
    const panelBox = (await panel.boundingBox())!
    const canvasBox = (await page.locator('.maplibregl-canvas').boundingBox())!
    expect(canvasBox.x).toBe(0)
    expect(panelBox.x).toBeGreaterThan(canvasBox.x)

    // the data-fair capture fires once map + vehicles are rendered
    await expect.poll(() => page.evaluate(() => (window as any).__captureCalled)).toBe(true)
  })

  test('triggers the capture only after the layers are rendered', async ({ page }) => {
    await mockApp(page, { shapesDelayMs: 800 })
    await page.goto('/')

    await expect.poll(() => page.evaluate(() => (window as any).__captureCalled)).toBe(true)
    const { captureAt, shapesAt } = await page.evaluate(() => ({
      captureAt: (window as any).__captureAt as number,
      shapesAt: (window as any).__shapesAt as number
    }))
    // negative check: without waiting for the layers, the capture fires before the shapes response
    expect(shapesAt).toBeGreaterThan(0)
    expect(captureAt).toBeGreaterThanOrEqual(shapesAt)
  })

  test('reports an unusable configuration without a linked « tracés » or « arrêts » dataset', async ({ page }) => {
    await mockApp(page, { withoutRelated: true, withoutRealtime: true })
    await page.goto('/')

    // the positive check is the previous test: here the error state must be visible
    await expect(page.getByText(/Aucun jeu lié/)).toBeVisible({ timeout: 10000 })
  })

  test('shows the map without realtime status when the feed is missing', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel).toBeVisible()
    // no realtime status without a feed (positive check: the counter shows with a feed)
    await expect(panel.locator('.rt-status')).toHaveCount(0)
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
  })

  test('reports a GTFS-RT feed without vehicle positions (TripUpdate)', async ({ page }) => {
    await mockApp(page, { feedKind: 'tripUpdate' })
    await page.goto('/')

    // the feed is fetched but unusable: the user must understand why
    const panel = page.locator('#map-panel-drawer')
    await expect(panel.getByText(/TripUpdate/)).toBeVisible({ timeout: 10000 })

    // the capture fires without waiting for vehicles (positive check: the first test)
    await expect.poll(() => page.evaluate(() => (window as any).__captureCalled)).toBe(true)
  })

  test('reports an empty GTFS-RT feed', async ({ page }) => {
    await mockApp(page, { feedKind: 'empty' })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.getByText(/aucun véhicule/)).toBeVisible({ timeout: 10000 })
  })

  test('restores the position and the selected route from the URL', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/?lng=-1.53&lat=47.205&zoom=12&_d_gtfs-shapes_route_id_eq=A')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    // the URL view must survive the shapes arrival (otherwise fitNetwork overwrites it)
    await expect(page.locator('.route-item')).toHaveCount(2)

    const view = await page.evaluate(() => {
      const m = window.__MAP__
      return m ? { lng: m.getCenter().lng, lat: m.getCenter().lat, zoom: m.getZoom() } : null
    })
    expect(view).not.toBeNull()
    expect(view!.lng).toBeCloseTo(-1.53, 5)
    expect(view!.lat).toBeCloseTo(47.205, 5)
    expect(view!.zoom).toBeCloseTo(12, 2)

    // the restored route is marked selected in the legend
    await expect(page.locator('.route-item[aria-pressed="true"]')).toHaveCount(1)
    await expect(page.locator('.route-item[aria-pressed="true"]')).toContainText('1')
    // a ring in the text colour, set off by the surface, marks it whatever the route colour
    await expect(page.locator('.route-item[aria-pressed="true"]')).toHaveCSS('outline-style', 'solid')
    await expect(page.locator('.route-item[aria-pressed="true"]')).toHaveCSS('outline-offset', '2px')
    await expect(page.locator('.route-item[aria-pressed="false"]').first()).toHaveCSS('outline-style', 'none')

    // and its details are open in the Selection section
    await expect(page.locator('#map-panel-drawer').getByText('Ligne 1')).toBeVisible()
    await expect(page.locator('#map-panel-drawer').getByText('Gare - Plage')).toBeVisible()
  })

  test('writes the navigation to the URL, restored after reload', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    // programmatic move: moveend must write lng/lat/zoom to the URL
    await page.evaluate(() => window.__MAP__!.jumpTo({ center: [-1.54, 47.2], zoom: 13 }))
    await expect.poll(() => page.evaluate(() => {
      const params = new URLSearchParams(window.location.search)
      return {
        lng: Number(params.get('lng')),
        lat: Number(params.get('lat')),
        zoom: Number(params.get('zoom'))
      }
    })).toEqual({ lng: -1.54, lat: 47.2, zoom: 13 })

    // reload: the navigated view is restored, not the network fit
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

  test('a click in the legend filters the map and opens the route details', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    // the legend click filters the shapes on the chosen route
    await panel.locator('.route-item').first().click()
    await expect(panel.getByText('Ligne 1')).toBeVisible()
    // the selection is written as a selection on the shapes dataset
    await expect.poll(() => new URL(page.url()).searchParams.get('_d_gtfs-shapes_route_id_eq')).toBe('A')
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines')))
      .toEqual(['==', ['get', 'route_id'], 'A'])
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-vehicles-circle')))
      .toEqual(['==', ['get', 'routeId'], 'A'])
    // stops are filtered by route short name (stops carry `routes`, not route_id)
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-stops-circle')))
      .toEqual(['in', '1', ['get', 'routes']])
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-stops-labels')))
      .toEqual(['in', '1', ['get', 'routes']])

    // click again: the route is deselected, the filter lifted and the details closed
    await panel.locator('.route-item').first().click()
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines'))).toBe(true)
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-vehicles-circle'))).toBe(true)
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-stops-circle'))).toBe(true)
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-stops-labels'))).toBe(true)
    await expect(panel.getByText('Ligne 1')).toBeHidden()
  })

  test('the route filter hides the stops of the other routes', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    // selecting a route refits the map: go back to the network so that
    // both stops are in view and queryable
    const showNetwork = () => page.evaluate(() => window.__MAP__!.jumpTo({ center: [-1.535, 47.2], zoom: 12.9 }))
    const renderedStops = () => page.evaluate(() => [
      ...new Set(window.__MAP__!.queryRenderedFeatures({ layers: ['gtfs-stops-circle'] })
        .map(f => (f.properties as any).stop_id as string))
    ].sort())

    // no filter: both stops (parent station excluded) are rendered
    await showNetwork()
    await expect.poll(renderedStops, { timeout: 15000 }).toEqual(['S1', 'S2'])

    // route 2: only the stop served by both routes stays rendered
    await panel.locator('.route-item').nth(1).click()
    await showNetwork()
    await expect.poll(renderedStops, { timeout: 15000 }).toEqual(['S1'])

    await panel.locator('.route-item').nth(1).click()
    await showNetwork()
    await expect.poll(renderedStops, { timeout: 15000 }).toEqual(['S1', 'S2'])
  })

  test('the route filter restricts the vehicles and the legend counter', async ({ page }) => {
    await mockApp(page, { vehicles: 2 })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await expect(panel.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })

    // one vehicle per route in the mocked feed: route 1 now counts only one
    await panel.locator('.route-item').first().click()
    await expect(panel.getByText(/1 véhicule/)).toBeVisible({ timeout: 10000 })

    await panel.locator('.route-item').first().click()
    await expect(panel.getByText(/2 véhicules/)).toBeVisible({ timeout: 10000 })
  })

  test('the configuration can restrict the display to a selection of routes', async ({ page }) => {
    await mockApp(page, { vehicles: 2, config: { routes: { mode: 'include', ids: ['A'] } } })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    // only route 1 is listed and only its vehicles are counted
    await expect(panel.locator('.route-item')).toHaveCount(1, { timeout: 15000 })
    await expect(panel.locator('.route-item')).toContainText('1')
    await expect(panel.getByText(/1 véhicule/)).toBeVisible({ timeout: 10000 })

    // a stop served by both routes only shows the allowed badge
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await expect(panel.locator('.v-expansion-panel', { hasText: 'Sélection' }).locator('.route-badge')).toHaveCount(1)
  })

  test('the configuration can hide a selection of routes', async ({ page }) => {
    await mockApp(page, { vehicles: 2, config: { routes: { mode: 'exclude', ids: ['A'] } } })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(1, { timeout: 15000 })
    await expect(panel.locator('.route-item')).toContainText('2')
    await expect(panel.getByText(/1 véhicule/)).toBeVisible({ timeout: 10000 })
  })

  test('a click on a route on the map opens the details without filtering', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    await clickMapAt(page, [-1.53, 47.21])
    await expect(panel.getByText('Ligne 1')).toBeVisible()

    // no filter applied by a map click
    const filter = await page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines'))
    expect(filter).toBe(true)

    // click on the empty map: the details close
    await clickMapAt(page, [-1.5, 47.18], { empty: true })
    await expect(panel.getByText('Ligne 1')).toBeHidden()
  })

  test('deselection: clicking the element again, clicking an empty area, Escape', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    // a click on the selected stop deselects it
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeHidden()

    // a click on an empty map area
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await clickMapAt(page, [-1.5, 47.18], { empty: true })
    await expect(panel.getByText('Gare Centrale')).toBeHidden()

    // Escape
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(panel.getByText('Gare Centrale')).toBeHidden()
    // the deselected Selection stays open on its hint
    const selection = panel.locator('.v-expansion-panel', { hasText: 'Sélection' }).locator('.v-expansion-panel-title')
    await expect(selection).toBeEnabled()
    await expect(selection).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByText('Cliquez sur un élément de la carte pour afficher ses informations.')).toBeVisible()
  })

  test('empty Selection: closed, opens on a hint, then shows the clicked stop', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    const selection = panel.locator('.v-expansion-panel', { hasText: 'Sélection' }).locator('.v-expansion-panel-title')
    await expect(selection).toBeEnabled()
    await expect(selection).toHaveAttribute('aria-expanded', 'false')
    await selection.click()
    const hint = panel.getByText('Cliquez sur un élément de la carte pour afficher ses informations.')
    await expect(hint).toBeVisible()
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await expect(hint).toHaveCount(0)
  })

  test('initial view: a route in the link without position frames that route', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/?_d_gtfs-shapes_route_id_eq=B')
    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await expect.poll(() => page.evaluate(() => {
      const b = window.__MAP__!.getBounds()
      return b.getWest() <= -1.55 && b.getEast() >= -1.52 && b.getSouth() <= 47.18 && b.getNorth() >= 47.19 && b.getNorth() < 47.215
    })).toBe(true)
  })

  test('initial view: the network extent, written with lng / lat / zoom', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await expect.poll(() => page.evaluate(() => {
      const b = window.__MAP__!.getBounds()
      return b.getWest() <= -1.56 && b.getEast() >= -1.5 && b.getSouth() <= 47.18 && b.getNorth() >= 47.22
    })).toBe(true)
    await page.evaluate(() => window.__MAP__!.jumpTo({ center: [-1.512345678, 47.212345678], zoom: 13.456 }))
    await expect.poll(() => new URL(page.url()).searchParams.toString()).toContain('lng=-1.51235&lat=47.21235&zoom=13.46')
  })

  test('initial view: no network extent at all, metropolitan France instead of (0, 0) at zoom 0', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    const empty = { type: 'FeatureCollection', features: [] }
    await page.route('**/api/v1/datasets/gtfs-shapes/lines*', route => route.fulfill({ json: empty }))
    await page.route('**/api/v1/datasets/gtfs-stops/lines*', route => route.fulfill({ json: empty }))
    await page.goto('/')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    const view = await page.evaluate(() => {
      const m = window.__MAP__!
      const fit = m.cameraForBounds([[-5.2, 41.3], [9.6, 51.1]])!
      return { lng: m.getCenter().lng, lat: m.getCenter().lat, zoom: m.getZoom(), fitZoom: fit.zoom! }
    })
    expect(view.lng).toBeCloseTo(2.2, 1)
    expect(view.lat).toBeGreaterThan(45)
    expect(view.lat).toBeLessThan(47.5)
    expect(view.zoom).toBeCloseTo(view.fitZoom, 1)
  })

  test('a click on a stop shows its details', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    // routes received as an array by the GeoJSON API: both route badges are rendered
    const badges = panel.locator('.v-expansion-panel', { hasText: 'Sélection' }).locator('.route-badge')
    await expect(badges).toHaveCount(2)
    // each badge carries its route color (shapes route_color), no fixed grey anymore
    await expect(badges.nth(0)).toHaveCSS('background-color', 'rgb(255, 136, 0)')
    await expect(badges.nth(1)).toHaveCSS('background-color', 'rgb(51, 170, 51)')
  })

  test('route badge: a chip with centred digits, route colours, a focus indicator on keyboard focus', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('#map-panel-drawer')
    const items = panel.locator('.route-item')
    await expect(items).toHaveCount(2, { timeout: 15000 })
    const badge = items.nth(0)
    await expect(badge).toHaveClass(/v-chip/)
    await expect(badge).toHaveText('1')
    // the digits' box, trimmed to cap height and baseline, is centred in the chip
    const chip = (await badge.boundingBox())!
    const digits = (await badge.locator('.route-badge__text').boundingBox())!
    const above = digits.y - chip.y
    const below = chip.y + chip.height - digits.y - digits.height
    expect(Math.abs(above - below)).toBeLessThanOrEqual(1)
    // route_color FF8800 as background, contrasted text colour
    await expect(badge).toHaveCSS('background-color', 'rgb(255, 136, 0)')
    await expect(badge).toHaveCSS('color', 'rgb(17, 17, 17)')
    // a badge outside the legend is not interactive
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.locator('.v-expansion-panel', { hasText: 'Sélection' }).locator('.route-badge').first()).not.toHaveAttribute('tabindex')
    // tabbing from the first route shows a focus indicator on the second one
    await items.nth(0).focus()
    await page.keyboard.press('Tab')
    await expect(items.nth(1)).toBeFocused()
    const indicator = await items.nth(1).evaluate((el) => {
      const overlay = el.querySelector('.v-chip__overlay')
      return el.matches(':focus-visible') && ((overlay && Number(getComputedStyle(overlay).opacity) > 0) || getComputedStyle(el).outlineStyle !== 'none')
    })
    expect(indicator).toBe(true)
    // the selected route: a ring off the chip, no check icon, same width
    const width = (await items.nth(1).boundingBox())!.width
    await page.keyboard.press('Enter')
    await expect(items.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(items.nth(1).locator('.v-chip__filter')).toHaveCount(0)
    await expect(items.nth(1)).toHaveCSS('outline-style', 'solid')
    expect((await items.nth(1).boundingBox())!.width).toBe(width)
  })

  test('mobile: bottom sheet for the legend and the details, with the mouse', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 800 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('#map-panel-drawer')).toHaveCount(0)
    const raise = page.getByRole('button', { name: 'Lever le panneau' })
    const lower = page.getByRole('button', { name: 'Baisser le panneau' })
    // folded: only the raise chevron
    await expect(raise).toHaveAttribute('aria-expanded', 'false')
    await expect(lower).toHaveCount(0)

    // the map keeps the height above the folded sheet (its rounded top overlaps it by 8 px)
    const canvasBox = (await page.locator('.maplibregl-canvas').boundingBox())!
    const handleBox = (await page.locator('.map-panel-handle').boundingBox())!
    expect(Math.round(canvasBox.y + canvasBox.height)).toBeLessThanOrEqual(Math.round(handleBox.y) + 8)

    // the chevrons open and close the sheet; the open sheet covers the map without resizing it
    await raise.click()
    await expect(lower).toHaveAttribute('aria-expanded', 'true')
    await expect(page.locator('.route-item')).toHaveCount(2)
    expect((await page.locator('.maplibregl-canvas').boundingBox())!.height).toBeCloseTo(canvasBox.height, 0)
    while (await lower.count()) await lower.click()
    await expect(raise).toHaveAttribute('aria-expanded', 'false')

    // empty Selection: no tab on a phone, no tab active while folded
    await expect(page.getByRole('tab', { name: 'Sélection' })).toHaveCount(0)
    await expect(page.getByRole('tab', { selected: true })).toHaveCount(0)

    // a tab opens the sheet on it
    const legendTab = page.getByRole('tab', { name: 'Légende' })
    await legendTab.click()
    await expect(legendTab).toHaveAttribute('aria-selected', 'true')

    // clicking a route switches to the Selection tab and opens the details
    await page.locator('.route-item').first().click()
    await expect(page.getByRole('tab', { name: 'Sélection' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.map-panel-sheet').getByText('Ligne 1')).toBeVisible()
  })

  test('intermediate width: collapsible panel closed by default', async ({ page }) => {
    await page.setViewportSize({ width: 700, height: 800 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    const drawer = page.locator('#map-panel-drawer')
    await expect(drawer).not.toBeInViewport()
    await page.getByRole('button', { name: 'Ouvrir le panneau' }).click()
    await expect(drawer).toBeInViewport()
    await expect(drawer.locator('.route-item')).toHaveCount(2)
    // panel on the right: the controls follow the edge of the open drawer, the tab under the zoom
    const zoom = page.locator('.maplibregl-ctrl-top-right .maplibregl-ctrl-group')
    const gap = async () => { const box = (await zoom.boundingBox())!; return Math.round((await drawer.boundingBox())!.x - box.x - box.width) }
    await expect.poll(async () => { const box = (await drawer.boundingBox())!; return Math.round(box.x + box.width) }).toBe(700)
    await expect.poll(gap).toBe(10)
    const drawerX = (await drawer.boundingBox())!.x
    const zoomBox = (await zoom.boundingBox())!
    const tabBox = (await page.locator('.map-panel-tab').boundingBox())!
    expect(Math.round(tabBox.x + tabBox.width)).toBe(Math.round(drawerX))
    expect(tabBox.y).toBeGreaterThan(zoomBox.y + zoomBox.height)
    const creditBox = (await page.locator('.maplibregl-ctrl-bottom-right .maplibregl-ctrl-attrib').boundingBox())!
    expect(creditBox.x + creditBox.width).toBeLessThanOrEqual(drawerX)
    await page.getByRole('button', { name: 'Fermer le panneau' }).click()
    await expect(drawer).not.toBeInViewport()

    // a new selection reopens the drawer closed by hand
    await page.getByRole('button', { name: 'Ouvrir le panneau' }).click()
    await drawer.locator('.route-item').first().click()
    await page.getByRole('button', { name: 'Fermer le panneau' }).click()
    await expect(drawer).not.toBeInViewport()
    await clickMapAt(page, [-1.54, 47.205])
    await expect(drawer).toBeInViewport()
    await expect(drawer.getByText('Gare Centrale')).toBeVisible()
  })

  test('dark theme: app and map controls follow the theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    await expect(page.locator('.v-application')).toHaveClass(/v-theme--dark/, { timeout: 15000 })
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    // built-in maplibre icons are dark images, inverted by the shared map-controls.css
    await expect(page.locator('.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon')).toHaveCSS('filter', 'invert(1)')
    // control group on the Vuetify surface colour, not maplibre's white
    const groupBg = await page.locator('.maplibregl-ctrl-group').first().evaluate(el => getComputedStyle(el).backgroundColor)
    expect(groupBg).not.toBe('rgb(255, 255, 255)')
  })

  test('dark high contrast: hc-dark theme and inverted icons', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    await expect(page.locator('.v-application')).toHaveClass(/v-theme--hc-dark/, { timeout: 15000 })
    await expect(page.locator('.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon')).toHaveCSS('filter', 'invert(1)')
  })

  test('English session: app and panel texts in English', async ({ page, context, baseURL }) => {
    await context.addCookies([{ name: 'i18n_lang', value: 'en', url: baseURL! }])
    await mockApp(page, { vehicles: 2 })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.getByText('Network routes')).toBeVisible({ timeout: 15000 })
    await expect(panel.getByText(/2 vehicles/)).toBeVisible({ timeout: 10000 })
    await expect(panel.getByText('Legend')).toBeVisible()
    await panel.locator('.route-item').first().click()
    await expect(panel.getByText('Route 1')).toBeVisible()
  })

  test('basemap switch: to void and back, quick double switch', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    // every tileserver basemap answers a minimal style carrying its name
    // dark-matter answers late, so the rapid double switch is a real race
    await page.route(/\/tileserver\/styles\/[^/]+\/style\.json/, async (route) => {
      const name = new URL(route.request().url()).pathname.split('/')[3]
      if (name === 'dark-matter') await new Promise(resolve => setTimeout(resolve, 300))
      await route.fulfill({ json: { version: 8, name, sources: {}, layers: [{ id: 'background', type: 'background' }] } })
    })
    await page.goto('/')
    await expect(page.locator('.v-navigation-drawer .route-item')).toHaveCount(2, { timeout: 15000 })

    const setStyle = (value: string) => page.evaluate(v => window.postMessage({ type: 'set-config', content: { field: 'map.style', value: v } }, '*'), value)
    const state = () => page.evaluate(() => {
      const map = window.__MAP__!
      return { name: map.getStyle()?.name ?? null, lines: !!map.getLayer('gtfs-lines'), loaded: map.isStyleLoaded() }
    })

    // void is an object style, loaded synchronously inside setStyle: the data layers come back
    await setStyle('void')
    await expect.poll(state).toEqual({ name: null, lines: true, loaded: true })
    await expect(page.locator('.maplibregl-ctrl-attrib')).not.toContainText('OpenStreetMap')
    await setStyle('positron')
    await expect.poll(state).toEqual({ name: 'positron', lines: true, loaded: true })
    await expect(page.locator('.maplibregl-ctrl-attrib')).toContainText('OpenStreetMap')

    // two choices in a row: the last one wins
    await setStyle('dark-matter')
    await setStyle('osm-bright')
    await expect.poll(state).toEqual({ name: 'osm-bright', lines: true, loaded: true })
    // still the last choice once the slow style has answered
    await page.waitForTimeout(600)
    expect(await state()).toEqual({ name: 'osm-bright', lines: true, loaded: true })
  })

  test.describe(() => {
    test.use({ expectedConsole: [...mapConsole, 'status of 500'] })

    test('a basemap that fails to load keeps the previous one, its data and its credit', async ({ page }) => {
      await mockApp(page, { withoutRealtime: true, config: { map: { style: 'void' } } })
      await page.route('**/tileserver/styles/positron/style.json', route => route.fulfill({ status: 500, body: 'error' }))
      await page.goto('/')
      await expect(page.locator('.v-navigation-drawer .route-item')).toHaveCount(2, { timeout: 15000 })

      await page.evaluate(() => window.postMessage({ type: 'set-config', content: { field: 'map.style', value: 'positron' } }, '*'))
      await page.waitForResponse('**/tileserver/styles/positron/style.json')
      await expect.poll(() => page.evaluate(() => {
        const map = window.__MAP__!
        return { layers: (map.getStyle()?.layers?.length ?? 0) > 0, lines: !!map.getLayer('gtfs-lines'), loaded: map.isStyleLoaded(), background: !!map.getLayer('background') }
      })).toEqual({ layers: true, lines: true, loaded: true, background: false })
      await expect(page.locator('.maplibregl-ctrl-attrib')).not.toContainText('OpenStreetMap')
    })
  })

  test('md (1000 px): the drawer over the map, closed at first', async ({ page }) => {
    await page.setViewportSize({ width: 1000, height: 800 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    const drawer = page.locator('#map-panel-drawer')
    await expect(drawer).not.toBeInViewport()
    await page.getByRole('button', { name: 'Ouvrir le panneau' }).click()
    await expect(drawer).toBeInViewport()
    // over the map: the canvas keeps the full width
    expect((await page.locator('.maplibregl-canvas').boundingBox())!.width).toBe(1000)
    await expect.poll(async () => { const box = (await drawer.boundingBox())!; return Math.round(box.x + box.width) }).toBe(1000)
    const zoom = page.locator('.maplibregl-ctrl-top-right .maplibregl-ctrl-group')
    await expect.poll(async () => { const box = (await zoom.boundingBox())!; return Math.round((await drawer.boundingBox())!.x - box.x - box.width) }).toBe(10)
  })

  test('lg (1300 px): the panel pushes the map, open at first, collapsed and reopened by its tab', async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 800 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const drawer = page.locator('#map-panel-drawer')
    await expect(drawer.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    const canvas = page.locator('.maplibregl-canvas')
    const width = (await drawer.boundingBox())!.width
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(1300 - width)
    const zoom = page.locator('.maplibregl-ctrl-top-right .maplibregl-ctrl-group')
    const zoomBox = (await zoom.boundingBox())!
    expect(Math.round(zoomBox.x + zoomBox.width)).toBe(1300 - width - 10)
    expect((await page.locator('.map-panel-tab').boundingBox())!.y).toBeGreaterThan(zoomBox.y + zoomBox.height)

    await page.getByRole('button', { name: 'Fermer le panneau' }).click()
    await expect(drawer).not.toBeInViewport()
    await expect.poll(async () => (await canvas.boundingBox())!.width).toBe(1300)
    const tabBox = (await page.locator('.map-panel-tab').boundingBox())!
    expect(Math.round(tabBox.x + tabBox.width)).toBe(1300)

    // a new selection reopens the collapsed panel
    await clickMapAt(page, [-1.54, 47.205])
    await expect(drawer).toBeInViewport()
    await expect(drawer.getByText('Gare Centrale')).toBeVisible()
  })

  test('crossing the 600, 840, 1145 and 1545 px breakpoints keeps the same map', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.setViewportSize({ width: 1280, height: 800 })
    await page.goto('/')
    await expect(page.locator('.v-navigation-drawer .route-item')).toHaveCount(2, { timeout: 15000 })
    await page.evaluate(() => { (window.__MAP__ as any).__marker = true })
    for (const width of [700, 400, 1000, 1600, 1280]) {
      await page.setViewportSize({ width, height: 800 })
      await expect(page.locator('.maplibregl-canvas')).toHaveCount(1)
      expect(await page.evaluate(() => (window.__MAP__ as any).__marker)).toBe(true)
    }
  })

  test('places the panel on the left when panelPosition is left', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true, config: { panelPosition: 'left' } })
    await page.goto('/')

    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    const panelBox = (await page.locator('#map-panel-drawer').boundingBox())!
    const canvasBox = (await page.locator('.maplibregl-canvas').boundingBox())!
    expect(panelBox.x).toBe(0)
    expect(canvasBox.x).toBeGreaterThan(panelBox.x)
    // map controls on the side of the panel, along its edge
    const zoomIn = page.locator('.maplibregl-ctrl-top-left .maplibregl-ctrl-zoom-in')
    await expect.poll(async () => Math.round((await zoomIn.boundingBox())!.x)).toBe(Math.round(panelBox.width) + 10)
    // maplibre UI strings follow the french session
    await expect(page.getByRole('button', { name: 'Zoom avant' })).toBeVisible()
    await expect(page.locator('.maplibregl-canvas')).toHaveAttribute('aria-label', 'Carte')
    await expect(page.locator('.maplibregl-ctrl-bottom-left .maplibregl-ctrl-attrib')).toBeVisible()
    // compact attribution (native « i ») stacked above the scale at the corner, no overlap
    await expect(page.locator('.maplibregl-ctrl-attrib.maplibregl-compact')).toHaveCount(1)
    const attribBox = (await page.locator('.maplibregl-ctrl-attrib').boundingBox())!
    const scaleBox = (await page.locator('.maplibregl-ctrl-bottom-left .maplibregl-ctrl-scale').boundingBox())!
    expect(attribBox.y + attribBox.height).toBeLessThanOrEqual(scaleBox.y)
    const zoomBox = (await page.locator('.maplibregl-ctrl-zoom-out').boundingBox())!
    expect(zoomBox.y + zoomBox.height).toBeLessThan(attribBox.y)
  })

  test('prefills realtime.url from the public link of the GTFS-RT attachment', async ({ page }) => {
    await mockApp(page)

    // parent page acting as data-fair in draft mode: in an iframe
    // window.parent !== window, so the app really posts its config updates
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

    // the attachment public link is pushed into the configuration
    await expect.poll(() => page.evaluate(() =>
      ((window as any).__setConfigs as any[]).find(c => c.field === 'realtime.url')?.value
    )).toBe('/api/v1/datasets/gtfs-meta/metadata-attachments/gtfs-rt.protobuf')

    // the related dataset family is pushed at the same time: without the DataCloneError fix
    // the exception interrupted resolve() before these two messages
    const datasets = await page.evaluate(() =>
      ((window as any).__setConfigs as any[]).find(c => c.field === 'datasets')?.value?.map((d: any) => d.id)
    )
    expect(datasets).toEqual(['gtfs-meta', 'gtfs-shapes', 'gtfs-stops', 'gtfs-stoptimes'])
  })
})

test.describe('wide screens (1600 px): the selection is a section of the panel', () => {
  test.use({ viewport: { width: 1600, height: 800 } })

  test('a stop opens the Sélection section of the panel, the map keeps its width, Escape deselects', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.locator('.v-expansion-panel-title', { hasText: 'Sélection' })).toHaveAttribute('aria-expanded', 'true')
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    // one drawer only, without a close button of its own
    await expect(page.locator('.v-navigation-drawer')).toHaveCount(1)
    await expect(page.getByRole('button', { name: 'Fermer la fiche' })).toHaveCount(0)
    await expect.poll(() => page.locator('.maplibregl-canvas').evaluate(el => el.getBoundingClientRect().width)).toBe(1600 - 400)

    await page.keyboard.press('Escape')
    await expect(page.getByText('Gare Centrale')).toHaveCount(0)
    await expect(panel.getByText('Cliquez sur un élément de la carte pour afficher ses informations.')).toBeVisible()
  })
})
