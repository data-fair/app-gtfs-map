/// <reference types="node" />
import type { Page } from '@playwright/test'
import { test as base, expect } from '@playwright/test'
import gtfsRealtimeBindings from 'gtfs-realtime-bindings'

const { transit_realtime: transitRealtime } = gtfsRealtimeBindings

// mockApp route handlers may still be in flight when a test ends (app requests
// the test does not await): silently purged on teardown, otherwise Playwright
// fails the test ("Test ended" while running route callback).
export const test = base.extend<{ consoleGuard: void, expectedConsole: string[] }>({
  page: async ({ page }, use) => {
    await use(page)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  },
  // messages a test provokes on purpose, named one by one: test.use({ expectedConsole: ['status of 500'] })
  // GPU stall due to ReadPixels: SwiftShader performance message as soon as the maplibre canvas draws
  expectedConsole: [['GPU stall due to ReadPixels'], { option: true }],
  consoleGuard: [async ({ page, expectedConsole }, use) => {
    const messages: string[] = []
    page.on('console', (msg) => {
      if (msg.type() !== 'error' && msg.type() !== 'warning') return
      if (expectedConsole.some(text => msg.text().includes(text))) return
      messages.push(`[${msg.type()}] ${msg.text()}`)
    })
    page.on('pageerror', (err) => {
      // harness artifact: Vite serves index.html raw, the inline `window.APPLICATION=%APPLICATION%` fails to parse
      if (err.message === "Unexpected token '%'") return
      messages.push(`[pageerror] ${err.message}`)
    })
    await use()
    expect(messages, 'console must stay clean').toEqual([])
  }, { auto: true }]
})
export { expect }

/** Minimal site info read by createSession without a request (_public.js script). */
const PUBLIC_SITE_INFO = {
  main: 'http://localhost',
  isAccountMain: true,
  logo: null,
  authMode: 'main',
  owner: { type: 'organization', id: 'orga' },
  theme: {
    colors: {
      primary: '#1976D2',
      secondary: '#424242',
      accent: '#82B1FF'
    },
    // the four session themes, resolved from prefers-color-scheme / forced-colors
    dark: true,
    darkColors: { background: '#121212', surface: '#212121', primary: '#2196F3', secondary: '#90CAF9', accent: '#FFB74D' },
    hc: true,
    hcColors: { background: '#FFFFFF', surface: '#FFFFFF', primary: '#0D47A1', secondary: '#000000', accent: '#BF360C' },
    hcDark: true,
    hcDarkColors: { background: '#000000', surface: '#000000', primary: '#FFEB3B', secondary: '#FFFFFF', accent: '#FFB74D' }
  }
}

/** Minimal basemap style: the dev stack has no tileserver (same as data-fair). */
const MINIMAL_STYLE = {
  version: 8,
  sources: {},
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#eeeeee' } }
  ]
}

export const SHAPES_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-1.56, 47.2], [-1.53, 47.21], [-1.5, 47.22]] },
      properties: { route_id: 'A', route_short_name: '1', route_long_name: 'Gare - Plage', route_color: 'FF8800' }
    },
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[-1.55, 47.19], [-1.52, 47.18]] },
      properties: { route_id: 'B', route_short_name: '2', route_long_name: 'Hôpital - Gare', route_color: '33AA33' }
    }
  ]
}

export const STOPS_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-1.54, 47.205] },
      properties: { stop_id: 'S1', stop_name: 'Gare Centrale', routes: ['1', '2'], location_type: '0' }
    },
    {
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-1.52, 47.215] },
      properties: { stop_id: 'S2', stop_name: 'Mairie', routes: ['1'], location_type: '0' }
    },
    {
      // parent station of S1/S2: must be filtered out, never rendered on the map
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-1.53, 47.21] },
      properties: { stop_id: 'SP', stop_name: 'Pôle Central', location_type: '1' }
    }
  ]
}

export type RtFeedKind = 'positions' | 'tripUpdate' | 'empty'

/** Encodes a minimal GTFS-RT feed: vehicle positions (default), TripUpdate only, or empty feed. */
export function buildRtFeed (
  vehicles: Array<{ id: string, routeId: string, lat: number, lng: number }>,
  kind: RtFeedKind = 'positions'
): Buffer {
  const entity = kind === 'empty'
    ? []
    : vehicles.map(v => kind === 'tripUpdate'
      ? {
          id: v.id,
          tripUpdate: {
            trip: { tripId: v.id, routeId: v.routeId },
            stopTimeUpdate: [{ stopSequence: 1, stopId: 'S1' }]
          }
        }
      : {
          id: v.id,
          vehicle: {
            trip: { routeId: v.routeId },
            position: { latitude: v.lat, longitude: v.lng },
            vehicle: { id: v.id }
          }
        })
  const message = transitRealtime.FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: '2.0' },
    entity
  })
  const bytes = transitRealtime.FeedMessage.encode(message).finish()
  return Buffer.from(bytes)
}

const DOCS: Record<string, any> = {
  'gtfs-meta': {
    id: 'gtfs-meta',
    href: '/api/v1/datasets/gtfs-meta',
    title: 'Réseau Test - métadonnées',
    relatedDatasets: [
      { id: 'gtfs-shapes', title: 'Réseau Test - tracés' },
      { id: 'gtfs-stops', title: 'Réseau Test - arrêts' },
      { id: 'gtfs-stoptimes', title: 'Réseau Test - horaires' }
    ],
    attachments: [
      { type: 'file', name: 'gtfs.zip' },
      {
        type: 'remoteFile',
        name: 'gtfs-rt.protobuf',
        // public link computed by data-fair, proxied to the real feed URL
        url: '/api/v1/datasets/gtfs-meta/metadata-attachments/gtfs-rt.protobuf'
      }
    ]
  },
  'gtfs-shapes': {
    id: 'gtfs-shapes',
    href: '/api/v1/datasets/gtfs-shapes',
    title: 'Réseau Test - tracés',
    relatedDatasets: [{ id: 'gtfs-meta', title: 'Réseau Test - métadonnées' }],
    schema: [{ key: 'geometry' }, { key: 'route_id' }, { key: 'route_short_name' }, { key: 'route_long_name' }, { key: 'route_color' }]
  },
  'gtfs-stops': {
    id: 'gtfs-stops',
    href: '/api/v1/datasets/gtfs-stops',
    title: 'Réseau Test - arrêts',
    relatedDatasets: [{ id: 'gtfs-meta', title: 'Réseau Test - métadonnées' }],
    schema: [{ key: 'geometry' }, { key: 'stop_id' }, { key: 'stop_name' }, { key: 'routes' }]
  },
  'gtfs-stoptimes': {
    id: 'gtfs-stoptimes',
    href: '/api/v1/datasets/gtfs-stoptimes',
    title: 'Réseau Test - horaires',
    relatedDatasets: [{ id: 'gtfs-meta', title: 'Réseau Test - métadonnées' }],
    schema: [{ key: 'trip_id' }, { key: 'arrival_time' }, { key: 'stop_id' }, { key: 'route_name' }]
  }
}

export interface MockOptions {
  /** configuration.datasets content, defaults to the metadata dataset with a full family */
  datasets?: any[]
  /** number of vehicles in the mocked feed (default 2) */
  vehicles?: number
  /** mocked realtime feed kind (default: vehicle positions) */
  feedKind?: RtFeedKind
  /** removes the realtime feed remote attachment */
  withoutRealtime?: boolean
  /** removes the related datasets of the metadata dataset */
  withoutRelated?: boolean
  /** delays the shapes dataset response (ms), to check capture/render order */
  shapesDelayMs?: number
  /** additional configuration fields (panelPosition, largePanel...) */
  config?: Record<string, unknown>
}

export async function mockApp (page: Page, options: MockOptions = {}) {
  await mockSite(page)

  const metaDoc = { ...DOCS['gtfs-meta'] }
  if (options.withoutRelated) metaDoc.relatedDatasets = []
  if (options.withoutRealtime) {
    metaDoc.attachments = (metaDoc.attachments ?? []).filter((a: any) => a.type !== 'remoteFile')
  }

  await page.addInitScript(({ appConfig }) => {
    (window as any).APPLICATION = {
      id: 'app1',
      title: 'Carte test',
      slug: 'carte-test',
      href: '/api/v1/applications/app1',
      exposedUrl: '/app/app1/',
      apiUrl: '/api/v1',
      wsUrl: '',
      owner: { type: 'organization', id: 'orga' },
      configuration: appConfig
    }
    ;(window as any).__captureCalled = false
    ;(window as any).__captureAt = 0
    ;(window as any).triggerCapture = () => {
      (window as any).__captureCalled = true
      ;(window as any).__captureAt = Date.now()
    }
  }, {
    appConfig: {
      datasets: options.datasets ?? [{ id: 'gtfs-meta', href: '/api/v1/datasets/gtfs-meta', title: 'Réseau Test - métadonnées' }],
      ...options.config
    }
  })

  // glyphs on the mocked origin: an empty glyph range is a valid answer
  await page.route('**/tileserver/styles/klokantech-basic/style.json*', route => route.fulfill({
    json: { ...MINIMAL_STYLE, glyphs: new URL(route.request().url()).origin + '/tileserver/fonts/{fontstack}/{range}.pbf' }
  }))
  await page.route('**/tileserver/fonts/**', route => route.fulfill({ contentType: 'application/x-protobuf', body: Buffer.alloc(0) }))
  await page.route('**/api/v1/datasets/gtfs-stoptimes/lines*', route => route.fulfill({ json: { total: 0, results: [] } }))
  await page.route('**/api/v1/datasets/gtfs-meta', route => route.fulfill({ json: metaDoc }))
  // related datasets are read in one list request (?ids=)
  await page.route(/\/api\/v1\/datasets\?/, route => {
    const ids = new URL(route.request().url()).searchParams.get('ids')?.split(',') ?? []
    const results = ids.map(id => DOCS[id]).filter(Boolean)
    return route.fulfill({ json: { count: results.length, results } })
  })
  await page.route('**/api/v1/datasets/gtfs-shapes', route => route.fulfill({ json: DOCS['gtfs-shapes'] }))
  await page.route('**/api/v1/datasets/gtfs-stops', route => route.fulfill({ json: DOCS['gtfs-stops'] }))
  await page.route('**/api/v1/datasets/gtfs-stoptimes', route => route.fulfill({ json: DOCS['gtfs-stoptimes'] }))
  await page.route('**/api/v1/datasets/gtfs-shapes/lines*', async route => {
    // __shapesAt is only read to check capture/render order: evaluate it only
    // in that case, otherwise the evaluate may run after the test has ended
    if (options.shapesDelayMs) {
      await new Promise(resolve => setTimeout(resolve, options.shapesDelayMs))
      await page.evaluate(() => { (window as any).__shapesAt = Date.now() })
    }
    await route.fulfill({ json: SHAPES_GEOJSON })
  })
  await page.route('**/api/v1/datasets/gtfs-stops/lines*', route => route.fulfill({ json: STOPS_GEOJSON }))
  await page.route('**/metadata-attachments/gtfs-rt.protobuf*', route => route.fulfill({
    contentType: 'application/octet-stream',
    body: buildRtFeed(Array.from({ length: options.vehicles ?? 2 }, (_, i) => ({
      id: `bus-${i + 1}`,
      routeId: i % 2 === 0 ? 'A' : 'B',
      lat: 47.2 + i * 0.005,
      lng: -1.55 + i * 0.005
    })), options.feedKind)
  }))
}

async function mockSite (page: Page) {
  await page.route('**/simple-directory/api/sites/_public.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.__PUBLIC_SITE_INFO = ${JSON.stringify(PUBLIC_SITE_INFO)};`
  }))
  await page.route('**/simple-directory/api/sites/_theme.css', route => route.fulfill({
    contentType: 'text/css',
    body: ''
  }))
}

/**
 * Clicks on the map at the given geographic coordinates.
 * `empty: true` for a deliberate click on an empty area (deselection).
 */
export async function clickMapAt (page: Page, lngLat: [number, number], { empty = false }: { empty?: boolean } = {}) {
  if (empty) {
    await page.waitForFunction(() => window.__MAP__!.loaded())
  } else {
    // GeoJSON sources are tiled and rendered asynchronously: without this
    // wait, queryRenderedFeatures may find nothing and the click is taken for
    // a click on an empty area (details never opened) — flakiness observed under load
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
