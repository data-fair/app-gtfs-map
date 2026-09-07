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

/** Convertit un message GTFS-RT VehiclePositions en FeatureCollection. */
export function feedToVehicles (
  buffer: ArrayBuffer,
  routeIndex: Map<string, RouteInfo>,
  fallbackColor: string
): VehicleCollection {
  const feed = transitRealtime.FeedMessage.decode(new Uint8Array(buffer))
  const features: Feature<Point, VehicleProperties>[] = []
  for (const entity of feed.entity ?? []) {
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
  return { type: 'FeatureCollection', features }
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
      vehicles.value = feedToVehicles(buffer, options.routeIndex.value, options.fallbackColor.value)
      lastUpdated.value = Date.now()
      error.value = null
    } catch (err: any) {
      error.value = err?.message ?? String(err)
    } finally {
      inFlight = false
    }
  }

  const restart = () => {
    stopTimer()
    if (!options.enabled.value || !options.url.value) {
      vehicles.value = EMPTY
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

  return { vehicles, lastUpdated, error }
}
