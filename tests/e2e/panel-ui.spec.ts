import { expect, mapConsole, mockApp, test } from './fixtures'

test.use({ expectedConsole: mapConsole })

// a basemap with a credit: the mocked style has none, so maplibre would hide the credit
const CREDITED_STYLE = {
  version: 8,
  sources: { credit: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© OpenStreetMap contributors' } },
  layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#eeeeee' } }, { id: 'credit', type: 'circle', source: 'credit' }]
}

const padding = (el: Element) => [getComputedStyle(el).paddingLeft, getComputedStyle(el).paddingRight]

test.describe('panel', () => {
  test('12 px gutter, static headers and toggle titles', async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 800 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('#map-panel-drawer')
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

  test('gallery thumbnail: no action button, only the scale and the credit', async ({ page }) => {
    await page.setViewportSize({ width: 1050, height: 450 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/?thumbnail=true')
    await expect(page.locator('.maplibregl-ctrl-scale')).toHaveCount(1, { timeout: 15000 })
    await expect(page.locator('.maplibregl-ctrl-attrib')).toHaveCount(1)
    await expect(page.locator('.maplibregl-ctrl-zoom-in')).toHaveCount(0)
    await expect(page.locator('.map-panel-tab')).toHaveCount(0)
  })

  test('section headings for screen readers, without any visual change', async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 800 })
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    // WAI-ARIA accordion pattern: each section button sits in a level 2 heading, the network name is level 3
    await expect(panel.getByRole('heading', { level: 2 })).toHaveText(['Sélection', 'Légende'])
    await expect(panel.getByRole('heading', { level: 3 }).first()).toBeVisible()
    const heading = panel.locator('h2.map-panel-heading').first()
    const button = heading.locator('.v-expansion-panel-title')
    // the heading adds no margin and no height around its button
    expect(await heading.evaluate(el => getComputedStyle(el).marginTop)).toBe('0px')
    expect((await heading.boundingBox())!.height).toBe((await button.boundingBox())!.height)
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
    const panelBg = await page.locator('#map-panel-drawer').first().evaluate(el => getComputedStyle(el).backgroundColor)
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
    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })
    await page.evaluate(() => window.postMessage({
      type: 'set-config',
      content: { configuration: { ...window.APPLICATION.configuration, panelPosition: 'left', routes: { mode: 'include', ids: ['A'] } } }
    }, '*'))
    await expect(panel.locator('.route-item')).toHaveCount(1)
    await expect.poll(async () => (await panel.boundingBox())!.x).toBe(0)
    expect(errors.filter(e => e !== "Unexpected token '%'")).toEqual([])
  })

  test('400 × 267 embed: map, credit and sheet inside the frame', async ({ page }) => {
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
    for (const locator of [frame.locator('.maplibregl-ctrl-zoom-in'), credit, frame.locator('.map-panel-sheet')]) {
      const box = (await locator.boundingBox())!
      expect(box.x).toBeGreaterThanOrEqual(0)
      expect(box.y).toBeGreaterThanOrEqual(0)
      expect(box.x + box.width).toBeLessThanOrEqual(400)
      expect(box.y + box.height).toBeLessThanOrEqual(267)
    }
  })
})
