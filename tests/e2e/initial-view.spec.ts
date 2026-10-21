import { expect } from '@playwright/test'
import { mockApp, test, SHAPES_GEOJSON, STOPS_GEOJSON } from './fixtures'

test.describe('initial view', () => {
  test('a resize before the first fit writes no (0, 0) view in the URL', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    // both layers answer late: the map is created and resized before any fit
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/v1/datasets/gtfs-shapes/lines*', async route => { await released; await route.fulfill({ json: SHAPES_GEOJSON }) })
    await page.route('**/api/v1/datasets/gtfs-stops/lines*', async route => { await released; await route.fulfill({ json: STOPS_GEOJSON }) })
    await page.goto('/')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    await page.waitForFunction(() => window.__MAP__?.loaded())

    // a background tab or an embed laid out late resizes the map: maplibre fires moveend
    await page.setViewportSize({ width: 1000, height: 700 })
    await page.evaluate(() => window.__MAP__!.resize())
    await page.waitForTimeout(600)
    expect(new URL(page.url()).searchParams.has('lng')).toBe(false)

    release()
    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await page.evaluate(() => window.__MAP__!.jumpTo({ center: [-1.512345678, 47.212345678], zoom: 13.456 }))
    await expect.poll(() => new URL(page.url()).searchParams.toString()).toContain('lng=-1.51235&lat=47.21235&zoom=13.46')
  })

  test('no network extent at all: metropolitan France instead of (0, 0) at zoom 0', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    const empty = { type: 'FeatureCollection', features: [] }
    await page.route('**/api/v1/datasets/gtfs-shapes/lines*', route => route.fulfill({ json: empty }))
    await page.route('**/api/v1/datasets/gtfs-stops/lines*', route => route.fulfill({ json: empty }))
    await page.goto('/')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    await page.waitForFunction(() => window.__MAP__?.loaded())
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

  test('an unknown route on an empty network: a user pan still writes the view to the URL', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    // nothing to fit on: the view is settled by the user only
    const empty = { type: 'FeatureCollection', features: [] }
    await page.route('**/api/v1/datasets/gtfs-shapes/lines*', route => route.fulfill({ json: empty }))
    await page.route('**/api/v1/datasets/gtfs-stops/lines*', route => route.fulfill({ json: empty }))
    await page.goto('/?route=unknown')
    await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    await page.waitForFunction(() => window.__MAP__?.loaded())
    const box = (await page.locator('.maplibregl-canvas').boundingBox())!
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 10 })
    await page.mouse.up()
    await expect.poll(() => [...new URL(page.url()).searchParams.keys()]).toEqual(expect.arrayContaining(['lng', 'lat', 'zoom']))
  })
})
