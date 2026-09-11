import { ref, shallowRef, watch, onScopeDispose, type Ref } from 'vue'
import gtfsRealtimeBindings from 'gtfs-realtime-bindings'
import type { Feature, FeatureCollection, Point } from 'geojson'
import { fetchBuffer } from './http.js'
import { type RouteInfo } from './gtfs.js'

// le paquet est CommonJS : import par défaut requis hors bundler
const { transit_realtime: transitRealtime } = gtfsRealtimeBindings

export interface VehicleProperties {
  id: string
  label: string
  routeId: string
  routeName: string
  color: string
  bearing: number | null
  speed: number | null
  timestamp: number
}

export type VehicleCollection = FeatureCollection<Point, VehicleProperties>

const EMPTY: VehicleCollection = { type: 'FeatureCollection', features: [] }

/**
 * État du flux temps réel décodé :
 * - `positions` : au moins une position de véhicule exploitable ;
 * - `trip-update` : flux TripUpdate, sans coordonnées (flux VehiclePositions attendu) ;
 * - `empty` : flux décodé mais sans aucune entité ;
 * - `error` : téléchargement ou décodage impossible ;
 * - `idle` : pas de flux configuré ou affichage désactivé.
 */
export type RealtimeFeedStatus = 'idle' | 'positions' | 'empty' | 'trip-update' | 'error'

export interface DecodedFeed {
  collection: VehicleCollection
  status: RealtimeFeedStatus
  counts: { entities: number, positions: number, tripUpdates: number }
}

/** Décode un message GTFS-RT et classe le flux (positions, vide ou TripUpdate sans coordonnées). */
export function decodeFeed (
  buffer: ArrayBuffer,
  routeIndex: Map<string, RouteInfo>,
  fallbackColor: string
): DecodedFeed {
  const feed = transitRealtime.FeedMessage.decode(new Uint8Array(buffer))
  const features: Feature<Point, VehicleProperties>[] = []
  let tripUpdates = 0
  for (const entity of feed.entity ?? []) {
    if (entity.tripUpdate) tripUpdates++
    const vp = entity.vehicle
    const position = vp?.position
    if (position == null || position.latitude == null || position.longitude == null) continue
    const routeId = vp?.trip?.routeId ?? ''
    const route = routeIndex.get(routeId)
    features.push({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [position.longitude, position.latitude] },
      properties: {
        id: vp?.vehicle?.id ?? entity.id ?? '',
        label: vp?.vehicle?.label ?? '',
        routeId,
        routeName: route?.shortName || routeId || '',
        color: route?.color ?? fallbackColor,
        bearing: position.bearing ?? null,
        speed: position.speed != null ? Math.round((position.speed) * 3.6) : null,
        timestamp: Number(vp?.timestamp ?? 0)
      }
    })
  }
  const collection: VehicleCollection = { type: 'FeatureCollection', features }
  const status: RealtimeFeedStatus = features.length > 0
    ? 'positions'
    : tripUpdates > 0 ? 'trip-update' : 'empty'
  return {
    collection,
    status,
    counts: { entities: feed.entity?.length ?? 0, positions: features.length, tripUpdates }
  }
}

/** Convertit un message GTFS-RT VehiclePositions en FeatureCollection. */
export function feedToVehicles (
  buffer: ArrayBuffer,
  routeIndex: Map<string, RouteInfo>,
  fallbackColor: string
): VehicleCollection {
  return decodeFeed(buffer, routeIndex, fallbackColor).collection
}

/**
 * Polling du flux GTFS-RT : décodage protobuf et mise à jour d'une FeatureCollection.
 * Le fetch passe par le proxy data-fair (pièce jointe distante) : pas de CORS.
 */
export function useVehicles (options: {
  url: Ref<string | undefined>
  enabled: Ref<boolean>
  intervalSeconds: Ref<number>
  routeIndex: Ref<Map<string, RouteInfo>>
  fallbackColor: Ref<string>
}) {
  const vehicles = shallowRef<VehicleCollection>(EMPTY)
  const lastUpdated = ref<number | null>(null)
  const status = ref<RealtimeFeedStatus>('idle')
  const error = ref<string | null>(null)

  let timer: ReturnType<typeof setInterval> | undefined
  let inFlight = false

  const stopTimer = () => {
    if (timer) {
      clearInterval(timer)
      timer = undefined
    }
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible' && options.enabled.value && options.url.value) poll()
  }

  async function poll () {
    if (!options.url.value || inFlight) return
    inFlight = true
    try {
      const buffer = await fetchBuffer(options.url.value)
      const decoded = decodeFeed(buffer, options.routeIndex.value, options.fallbackColor.value)
      vehicles.value = decoded.collection
      status.value = decoded.status
      lastUpdated.value = Date.now()
      error.value = null
    } catch (err: any) {
      status.value = 'error'
      error.value = err?.message ?? String(err)
    } finally {
      inFlight = false
    }
  }

  const restart = () => {
    stopTimer()
    if (!options.enabled.value || !options.url.value) {
      vehicles.value = EMPTY
      status.value = 'idle'
      return
    }
    poll()
    const intervalMs = Math.max(5, options.intervalSeconds.value || 15) * 1000
    timer = setInterval(() => {
      // économise le flux quand l'onglet est en arrière-plan
      if (document.visibilityState === 'visible') poll()
    }, intervalMs)
  }

  watch(() => [options.url.value, options.enabled.value, options.intervalSeconds.value], restart, { immediate: true })
  watch(() => options.routeIndex.value, () => { if (options.enabled.value && options.url.value) poll() })
  document.addEventListener('visibilitychange', onVisibility)
  onScopeDispose(() => {
    stopTimer()
    document.removeEventListener('visibilitychange', onVisibility)
  })

  return { vehicles, lastUpdated, status, error }
}
