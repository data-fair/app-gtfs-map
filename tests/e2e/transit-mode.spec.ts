import type { Page } from '@playwright/test'
import { clickMapAt, expect, mapConsole, mockApp, SHAPES_GEOJSON, test } from './fixtures'

test.use({ expectedConsole: mapConsole })

/** Serves the shapes with the given route_type per route_id (registered after mockApp, so it wins). */
async function mockRouteTypes (page: Page, types: Record<string, number>) {
  await page.route('**/api/v1/datasets/gtfs-shapes/lines*', route => route.fulfill({
    json: {
      ...SHAPES_GEOJSON,
      features: SHAPES_GEOJSON.features.map(f => ({ ...f, properties: { ...f.properties, route_type: types[f.properties.route_id] } }))
    }
  }))
}

test.describe('transit mode', () => {
  test('legend grouped by mode, single selection and Tab between groups, mode in the detail cards', async ({ page }) => {
    await mockApp(page, { vehicles: 2 })
    await mockRouteTypes(page, { A: 3, B: 1 })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    // metro first, then bus, each group named by its title
    const groups = panel.getByRole('group')
    await expect(groups).toHaveCount(2)
    const metro = panel.getByRole('group', { name: 'Métro' })
    const bus = panel.getByRole('group', { name: 'Bus' })
    await expect(groups.first()).toHaveAccessibleName('Métro')
    await expect(metro.locator('.route-item')).toHaveText('2')
    await expect(bus.locator('.route-item')).toHaveText('1')

    // one selection across the groups
    await metro.locator('.route-item').click()
    await expect(panel.locator('.route-item[aria-pressed="true"]')).toHaveText('2')
    await bus.locator('.route-item').click()
    await expect(panel.locator('.route-item[aria-pressed="true"]')).toHaveCount(1)
    await expect(panel.locator('.route-item[aria-pressed="true"]')).toHaveText('1')

    // route details: badge, then the mode as icon + text
    await expect(panel.getByText('Ligne 1')).toBeVisible()
    await expect(panel.getByText('Ligne 1').locator('..')).toContainText('Bus')

    // the selection ring is not clipped by the chip group
    const selected = panel.locator('.route-item[aria-pressed="true"]')
    const ring = (await selected.boundingBox())!
    const container = (await bus.locator('.v-slide-group__container').boundingBox())!
    expect(ring.x - 4).toBeGreaterThanOrEqual(container.x - 0.5)
    expect(ring.y - 4).toBeGreaterThanOrEqual(container.y - 0.5)
    expect(ring.y + ring.height + 4).toBeLessThanOrEqual(container.y + container.height + 0.5)

    // native keyboard: arrows stay within a group (one chip here, so focus stays), Tab moves to the next group
    await metro.locator('.route-item').focus()
    await page.keyboard.press('ArrowRight')
    await expect(metro.locator('.route-item')).toBeFocused()
    await page.keyboard.press('Tab')
    await expect(bus.locator('.route-item')).toBeFocused()

    // vehicle details: bus-2 runs on route B (metro)
    await bus.locator('.route-item').click()
    await expect(panel.locator('.route-item[aria-pressed="true"]')).toHaveCount(0)
    await clickMapAt(page, [-1.545, 47.205])
    await expect(panel.getByText('bus-2', { exact: true }).locator('..')).toContainText('Métro')
  })

  test('single-mode network: neither group title nor mode in the detail card', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    // a route without mode does not count as a second mode
    await mockRouteTypes(page, { A: 3 })
    await page.goto('/')

    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await expect(panel.getByRole('group')).toHaveCount(0)
    await expect(panel.getByText('Bus', { exact: true })).toHaveCount(0)

    await panel.locator('.route-item').first().click()
    await expect(panel.getByText('Ligne 1')).toBeVisible()
    await expect(panel.getByText('Ligne 1').locator('..')).not.toContainText('Bus')
  })
})
