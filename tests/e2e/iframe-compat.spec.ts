// d-frame compatibility: the v-iframe-compat shim DataFair injects when the
// app is embedded (portal, dashboard) reads window.vIframeOptions to apply
// parent updateSrc calls without reloading the iframe.
import { expect, mapConsole, mockApp, test } from './fixtures'

test.use({ expectedConsole: mapConsole })

test.describe('d-frame compatibility (v-iframe-compat shim)', () => {
  test('exposes reactiveSearchParams to the shim as soon as the module is evaluated', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    // set at main.ts module level, before createApp: present from page load
    const exposed = await page.evaluate(() => {
      const opts = window.vIframeOptions
      return !!opts && typeof opts.reactiveParams === 'object' && opts.reactiveParams !== null
    })
    expect(exposed).toBe(true)
  })

  test('the params written by the shim go through the URL sync of the lib', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')

    // write as the shim does on updateSrc: it is the lib's reactive singleton,
    // so the parameter is reflected in the URL
    await page.evaluate(() => {
      window.vIframeOptions!.reactiveParams['_d_gtfs-shapes_route_id_eq'] = 'B'
    })
    await expect.poll(() => page.evaluate(() =>
      new URLSearchParams(window.location.search).get('_d_gtfs-shapes_route_id_eq')
    )).toBe('B')
  })

  test('a route written by the parent selects it on the map and in the panel', async ({ page }) => {
    await mockApp(page, { withoutRealtime: true })
    await page.goto('/')
    const panel = page.locator('#map-panel-drawer')
    await expect(panel.locator('.route-item')).toHaveCount(2, { timeout: 15000 })

    await page.evaluate(() => { window.vIframeOptions!.reactiveParams['_d_gtfs-shapes_route_id_eq'] = 'A' })
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines')))
      .toEqual(['==', ['get', 'route_id'], 'A'])
    await expect(panel.getByText('Ligne 1')).toBeVisible()

    await page.evaluate(() => { delete window.vIframeOptions!.reactiveParams['_d_gtfs-shapes_route_id_eq'] })
    await expect.poll(() => page.evaluate(() => window.__MAP__!.getFilter('gtfs-lines'))).toBe(true)
    await expect(panel.getByText('Ligne 1')).toBeHidden()
  })
})

// d-frame first lays the iframe out at the width of its parent and 0 px high, then gives it its
// size: the map waits for that size, so it frames the network and folds its credit as on a phone
test('a frame laid out wide and 0 px high first: the map frames the network at its final size', async ({ page }) => {
  await mockApp(page, { withoutRealtime: true })
  await page.route('**/frame-test.html', route => route.fulfill({
    contentType: 'text/html',
    body: '<!doctype html><body style="margin:0"><iframe id="f" src="./" style="border:0;display:block;width:925px;height:0"></iframe></body>'
  }))
  await page.goto('/frame-test.html')
  const frame = page.frameLocator('#f')
  await expect(frame.locator('#map-panel-drawer')).toBeAttached({ timeout: 15000 })
  await page.evaluate(() => {
    const f = document.getElementById('f')!
    f.style.width = '400px'
    f.style.height = '267px'
  })
  const attribution = frame.locator('.maplibregl-ctrl-attrib')
  await expect(attribution).toHaveClass(/maplibregl-compact/, { timeout: 15000 })
  await expect(attribution).not.toHaveClass(/maplibregl-compact-show/)
  const app = page.frames().find(f => f !== page.mainFrame())!
  await expect.poll(() => app.evaluate(() => {
    const map = window.__MAP__!
    const stops = (map.getSource('gtfs-stops') as any)?.serialize().data?.features ?? []
    return stops.length > 0 && stops.every((s: any) => map.getBounds().contains(s.geometry.coordinates))
  }), { timeout: 15000 }).toBe(true)
})
