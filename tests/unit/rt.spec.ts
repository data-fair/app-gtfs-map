import { expect, test } from '@playwright/test'
import gtfsRealtimeBindings from 'gtfs-realtime-bindings'
import { decodeFeed, feedToVehicles, type VehicleCollection } from '../../src/composables/use-vehicles'

// le paquet est CommonJS : import par défaut requis hors bundler
const { transit_realtime: transitRealtime } = gtfsRealtimeBindings

const fallbackColor = '#1976D2'
const routeIndex = new Map([
  ['ROUTE-A', { routeId: 'ROUTE-A', shortName: '1', longName: 'Gare - Plage', color: '#FF8800' }],
  ['ROUTE-B', { routeId: 'ROUTE-B', shortName: '2', longName: 'Hôpital - Gare', color: '#33AA33' }]
])

const buildFeed = (entities: any[]): ArrayBuffer => {
  const message = transitRealtime.FeedMessage.fromObject({
    header: { gtfsRealtimeVersion: '2.0', incrementality: 0 },
    entity: entities
  })
  // finish() renvoie un Buffer Node (avec pool mémoire) : copie exacte obligatoire
  const bytes = transitRealtime.FeedMessage.encode(message).finish()
  const exact = new Uint8Array(bytes.byteLength)
  exact.set(bytes)
  return exact.buffer
}

test('décode les positions de véhicules et les enrichit des infos de ligne', async () => {
  const buffer = buildFeed([
    {
      id: 'v1',
      vehicle: {
        trip: { tripId: 't1', routeId: 'ROUTE-A', directionId: 1 },
        position: { latitude: 47.1, longitude: -1.5, bearing: 90, speed: 8.33 },
        vehicle: { id: 'bus-42', label: 'Bus 42' },
        timestamp: 1700000000
      }
    },
    {
      id: 'v2',
      vehicle: {
        trip: { routeId: 'ROUTE-UNKNOWN' },
        position: { latitude: 47.2, longitude: -1.6 }
      }
    }
  ])

  const result: VehicleCollection = feedToVehicles(buffer, routeIndex, fallbackColor)
  expect(result.features).toHaveLength(2)

  const [first, second] = result.features
  // protobuf stocke lat/lng en float32 : comparer avec tolérance
  expect(first.geometry.type).toBe('Point')
  expect(first.geometry.coordinates[0]).toBeCloseTo(-1.5, 5)
  expect(first.geometry.coordinates[1]).toBeCloseTo(47.1, 5)
  expect(first.properties).toMatchObject({
    id: 'bus-42',
    label: 'Bus 42',
    routeId: 'ROUTE-A',
    routeName: '1',
    color: '#FF8800',
    bearing: 90,
    speed: 30,
    timestamp: 1700000000
  })

  expect(second.properties.routeName).toBe('ROUTE-UNKNOWN')
  expect(second.properties.color).toBe(fallbackColor)
  // protobufjs décode l'absence de vitesse en 0 (défaut scalaire)
  expect(second.properties.speed).toBe(0)
})

test('ignore les entités sans position', async () => {
  const buffer = buildFeed([
    { id: 'v1', vehicle: { trip: { routeId: 'ROUTE-A' } } },
    { id: 'v2' }
  ])
  const result = feedToVehicles(buffer, routeIndex, fallbackColor)
  expect(result.features).toHaveLength(0)
})

test('décode un flux vide', async () => {
  const buffer = buildFeed([])
  const result = feedToVehicles(buffer, routeIndex, fallbackColor)
  expect(result.type).toBe('FeatureCollection')
  expect(result.features).toHaveLength(0)
})

test('classe un flux avec positions de véhicules', async () => {
  const buffer = buildFeed([
    {
      id: 'v1',
      vehicle: {
        trip: { routeId: 'ROUTE-A' },
        position: { latitude: 47.1, longitude: -1.5 }
      }
    }
  ])
  const decoded = decodeFeed(buffer, routeIndex, fallbackColor)
  expect(decoded.status).toBe('positions')
  expect(decoded.collection.features).toHaveLength(1)
  expect(decoded.counts).toEqual({ entities: 1, positions: 1, tripUpdates: 0 })
})

test('signale un flux TripUpdate sans positions', async () => {
  const buffer = buildFeed([
    { id: 't1', tripUpdate: { trip: { tripId: 't1', routeId: 'ROUTE-A' }, stopTimeUpdate: [] } },
    { id: 't2', tripUpdate: { trip: { tripId: 't2', routeId: 'ROUTE-B' } } }
  ])
  const decoded = decodeFeed(buffer, routeIndex, fallbackColor)
  expect(decoded.status).toBe('trip-update')
  expect(decoded.collection.features).toHaveLength(0)
  expect(decoded.counts).toEqual({ entities: 2, positions: 0, tripUpdates: 2 })
})

test('signale un flux décodé sans aucune entité', async () => {
  const decoded = decodeFeed(buildFeed([]), routeIndex, fallbackColor)
  expect(decoded.status).toBe('empty')
  expect(decoded.collection.features).toHaveLength(0)
  expect(decoded.counts.entities).toBe(0)
})

test('signale un flux de véhicules sans position comme vide', async () => {
  const buffer = buildFeed([{ id: 'v1', vehicle: { trip: { routeId: 'ROUTE-A' } } }])
  const decoded = decodeFeed(buffer, routeIndex, fallbackColor)
  expect(decoded.status).toBe('empty')
  expect(decoded.collection.features).toHaveLength(0)
})
