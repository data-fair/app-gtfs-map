/// <reference types="node" />
import type { Page } from '@playwright/test'
import gtfsRealtimeBindings from 'gtfs-realtime-bindings'

const { transit_realtime: transitRealtime } = gtfsRealtimeBindings

/** Info de site minimale lue par createSession sans requête (script _public.js). */
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
    }
  }
}

/** Style de fond minimal : le dev stack n'a pas de tileserver (comme chez data-fair). */
const MINIMAL_STYLE = {
  version: 8,
  glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
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
      // station parente de S1/S2 : doit être filtrée, jamais rendue sur la carte
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [-1.53, 47.21] },
      properties: { stop_id: 'SP', stop_name: 'Pôle Central', location_type: '1' }
    }
  ]
}

export type RtFeedKind = 'positions' | 'tripUpdate' | 'empty'

/** Encode un flux GTFS-RT minimal : positions de véhicules (défaut), TripUpdate seul ou flux vide. */
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
        // lien public calculé par data-fair, proxifié vers l'URL réelle du flux
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
  /** contenu de configuration.datasets — par défaut le jeu de métadonnées avec famille complète */
  datasets?: any[]
  /** nombre de véhicules dans le flux mocké (défaut 2) */
  vehicles?: number
  /** type de flux temps réel mocké (défaut : positions de véhicules) */
  feedKind?: RtFeedKind
  /** retire la pièce jointe distante du flux temps réel */
  withoutRealtime?: boolean
  /** retire les jeux liés du jeu de métadonnées */
  withoutRelated?: boolean
  /** retarde la réponse du jeu « tracés » (ms), pour vérifier l'ordre capture/rendu */
  shapesDelayMs?: number
  /** champs de configuration additionnels (panelPosition, largePanel...) */
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

  await page.route('**/tileserver/styles/klokantech-basic/style.json*', route => route.fulfill({ json: MINIMAL_STYLE }))
  await page.route('**/api/v1/datasets/gtfs-meta', route => route.fulfill({ json: metaDoc }))
  await page.route('**/api/v1/datasets/gtfs-shapes', route => route.fulfill({ json: DOCS['gtfs-shapes'] }))
  await page.route('**/api/v1/datasets/gtfs-stops', route => route.fulfill({ json: DOCS['gtfs-stops'] }))
  await page.route('**/api/v1/datasets/gtfs-stoptimes', route => route.fulfill({ json: DOCS['gtfs-stoptimes'] }))
  await page.route('**/api/v1/datasets/gtfs-shapes/lines*', async route => {
    if (options.shapesDelayMs) await new Promise(resolve => setTimeout(resolve, options.shapesDelayMs))
    await page.evaluate(() => { (window as any).__shapesAt = Date.now() })
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
