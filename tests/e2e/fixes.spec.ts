import { expect } from '@playwright/test'
import { clickMapAt, mockApp, test, SHAPES_GEOJSON } from './fixtures'

// M réso publishes route_id as an integer column
const INTEGER_SHAPES = {
  ...SHAPES_GEOJSON,
  features: SHAPES_GEOJSON.features.map((f, i) => ({ ...f, properties: { ...f.properties, route_id: 91 + i } }))
}

test.describe('fixes', () => {
  test('integer route ids: a shared route=91 link selects that route', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.route('**/api/v1/datasets/gtfs-shapes/lines*', route => route.fulfill({ json: INTEGER_SHAPES }))
    await page.goto('/?route=91')
    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await expect(panel.locator('.route-item[aria-pressed="true"]')).toHaveCount(1)
    await expect(panel.getByText('Gare - Plage')).toBeVisible()
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines'))).toEqual(['==', ['get', 'route_id'], '91'])
  })

  test('integer route ids: the configuration can hide a list of routes', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true, config: { routes: { mode: 'exclude', ids: ['91'] } } })
    await page.route('**/api/v1/datasets/gtfs-shapes/lines*', route => route.fulfill({ json: INTEGER_SHAPES }))
    await page.goto('/')
    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(1, { timeout: 15000 })
    await expect(panel.locator('.route-item')).toContainText('2')
  })

  test('a timetable that fails to load says so instead of loading forever', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.route('**/api/v1/datasets/gtfs-stoptimes/lines*', route => route.fulfill({ status: 500, json: { error: 'boom' } }))
    await page.goto('/')
    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await expect(panel.getByText('Horaires indisponibles')).toBeVisible()
    await expect(panel.getByText('Chargement…')).toHaveCount(0)
  })
})
