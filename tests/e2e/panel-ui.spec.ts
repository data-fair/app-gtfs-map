import { expect } from '@playwright/test'
import { clickMapAt, mockApp, test } from './fixtures'

// a basemap with a credit: the mocked style has none, so maplibre would hide the credit
const CREDITED_STYLE = {
  version: 8,
  sources: { credit: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eeeeee' } }, { id: 'credit', type: 'circle', source: 'credit' }]
}

const padding = (el: Element) => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]

test.describe('panel', () => {
  test('12 px gutter, static headers and toggle titles', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    const selection = panel.locator('.v-expansion-panel-title').nth(0)
    const legend = panel.locator('.v-expansion-panel-title').nth(1)
    expect(await legend.evaluate(padding)).toEqual(['12px', '12px'])
    expect(await panel.locator('.v-expansion-panel-text__wrapper').first().evaluate(padding)).toEqual(['12px', '12px'])
    await expect(legend).toHaveAttribute('title', 'Replier « Légende »')
    await expect(selection).toHaveAttribute('title', 'Déplier « Sélection »')
    // the open header is as high as the closed one
    const closedHeight = (await selection.boundingBox())!.height
    expect((await legend.boundingBox())!.height).toBe(closedHeight)
    await legend.click()
    await expect(legend).toHaveAttribute('title', 'Déplier « Légende »')
  })

  test('empty Selection: closed, opens on the hint, then shows the clicked stop', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    const selection = panel.locator('.v-expansion-panel-title').nth(0)
    await expect(selection).toBeEnabled()
    await expect(selection).toHaveAttribute('aria-expanded', 'false')
    await selection.click()
    const hint = panel.getByText('Cliquez sur une ligne, un arrêt ou un véhicule de la carte pour afficher son détail.')
    await expect(hint).toBeVisible()
    await clickMapAt(page, [-1.54, 47.205])
    await expect(panel.getByText('Gare Centrale')).toBeVisible()
    await expect(hint).toHaveCount(0)
  })

  test('mobile: the empty Selection tab shows the hint', async ({ page }) => {
    await page.setViewportSize({ width: 400, height: 850 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const tab = page.locator('.v-bottom-navigation .v-btn', { hasText: 'Sélection' })
    await expect(tab).toBeEnabled({ timeout: 15000 })
    await tab.click()
    await expect(page.getByText('Cliquez sur une ligne, un arrêt ou un véhicule de la carte pour afficher son détail.')).toBeVisible()
  })

  test('dark theme: panel texts and map controls follow the theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    await expect(page.locator('.v-application')).toHaveClass(/v-theme--dark/, { timeout: 15000 })
    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    // « Lignes du réseau » no longer a fixed grey on the dark surface
    const routesTitle = page.getByText('Lignes du réseau')
    expect(await routesTitle.evaluate(el => getComputedStyle(el).color)).not.toBe('rgb(119, 119, 119)')
    await expect(page.locator('.maplibregl-ctrl-zoom-in .maplibregl-ctrl-icon')).toHaveCSS('filter', 'invert(1)')
    const groupBg = await page.locator('.maplibregl-ctrl-group').first().evaluate(el => getComputedStyle(el).backgroundColor)
    expect(groupBg).not.toBe('rgb(255, 255, 255)')
  })

  test('hc-dark: panel and credit on the dark high-contrast theme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark', forcedColors: 'active' })
    await mockApp(page, { withoutRealtime: true })
    await page.route('**/tileserver/styles/klokantech-basic/style.json*', route => route.fulfill({ json: CREDITED_STYLE }))
    await page.goto('/')
    await expect(page.locator('.v-application')).toHaveClass(/v-theme--hc-dark/, { timeout: 15000 })
    await expect(page.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    const panelBg = await page.locator('.navigation-side .v-expansion-panel').first().evaluate(el => getComputedStyle(el).backgroundColor)
    expect(panelBg).toBe('rgb(0, 0, 0)')
    const credit = page.locator('.maplibregl-ctrl-attrib')
    await expect(credit).toBeVisible()
    expect(await credit.evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgb(255, 255, 255)')
  })

  test('draft: a configuration edited in the form reloads the panel without error', async ({ page }) => {
    const errors: string[] = []
    page.on('pageerror', err => errors.push(err.message))
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/?draft=true')
    const panel = page.locator('.navigation-side')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await page.evaluate(() => window.postMessage({
      type: 'set-config',
      content: { configuration: { ...window.APPLICATION.configuration, panelPosition: 'left', routes: { mode: 'include', ids: ['A'] } } }
    }, '*'))
    await expect(panel.locator('.route-item')).toHaveCount(1)
    await expect.poll(async () => (await panel.boundingBox())!.x).toBe(0)
    await expect(panel.locator('.v-expansion-panel-title')).toHaveCount(2)
    expect(errors.filter(e => e !== "Unexpected token '%'")).toEqual([])
  })

  test('400 × 267 embed: map, credit and tabs inside the frame', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.route('**/tileserver/styles/klokantech-basic/style.json*', route => route.fulfill({ json: CREDITED_STYLE }))
    await page.route('**/frame-test.html', route => route.fulfill({
      contentType: 'text/html',
      body: '<!doctype html><body style="margin:0"><iframe id="f" src="./" style="border:0;display:block;width:400px;height:267px"></iframe></body>'
    }))
    await page.goto('/frame-test.html')
    const frame = page.frameLocator('#f')
    await expect(frame.locator('.maplibregl-canvas')).toBeVisible({ timeout: 15000 })
    const credit = frame.locator('.maplibregl-ctrl-attrib')
    await expect(credit).toHaveClass(/maplibregl-compact/)
    await expect(credit).not.toHaveClass(/maplibregl-compact-show/)
    for (const locator of [frame.locator('.maplibregl-ctrl-zoom-in'), credit, frame.locator('.v-bottom-navigation .v-btn').first(), frame.locator('.v-bottom-navigation .v-btn').last()]) {
      const box = (await locator.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(400)
      expect(box.y + box.height).toBeLessThanOrEqual(267)
    }
  })

  test('route badge: a chip with centred digits, route colours, a focus indicator on keyboard focus', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const items = page.locator('.navigation-side .route-item')
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
    await expect(page.locator('.gtfs-details .route-badge').first()).not.toHaveAttribute('tabindex')
    // tabbing from the first route shows a focus indicator on the second one
    await items.nth(0).focus()
    await page.keyboard.press('Tab')
    await expect(items.nth(1)).toBeFocused()
    const indicator = await items.nth(1).evaluate((el) => {
      const overlay = el.querySelector('.v-chip__overlay')
      return el.matches(':focus-visible') && ((overlay && Number(getComputedStyle(overlay).opacity) > 0) || getComputedStyle(el).outlineStyle !== 'none')
    })
    expect(indicator).toBe(true)
    // the selected route: a theme-coloured frame, no check icon, same width
    const width = (await items.nth(1).boundingBox())!.width
    const border = await items.nth(1).evaluate(el => getComputedStyle(el).borderTopColor)
    await page.keyboard.press('Enter')
    await expect(items.nth(1)).toHaveAttribute('aria-pressed', 'true')
    await expect(items.nth(1).locator('.v-chip__filter')).toHaveCount(0)
    expect(await items.nth(1).evaluate(el => getComputedStyle(el).borderTopColor)).not.toBe(border)
    expect(await items.nth(1).evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('2px')
    expect((await items.nth(1).boundingBox())!.width).toBe(width)
  })
})
