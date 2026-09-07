<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { createApp } from 'vue'
import maplibregl from 'maplibre-gl'
import type { GeoJSONSource, LngLatBoundsLike, MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import RoutePopup from './route-popup.vue'
import StopPopup from './stop-popup.vue'
import VehiclePopup from './vehicle-popup.vue'
import type { RouteInfo } from '@/composables/gtfs.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'

const props = defineProps({
  shapes: { type: Object as PropType<FeatureCollection | null>, default: null },
  stops: { type: Object as PropType<FeatureCollection | null>, default: null },
  vehicles: { type: Object as PropType<FeatureCollection<Point, VehicleProperties> | null>, default: null },
  routeIndex: { type: Map as PropType<Map<string, RouteInfo>>, required: true },
  styleUrl: { type: String, required: true },
  showLines: { type: Boolean, default: true },
  showStops: { type: Boolean, default: true },
  showStopLabels: { type: Boolean, default: true },
  showVehicles: { type: Boolean, default: true },
  lineWidth: { type: Number, default: 4 },
  stopRadius: { type: Number, default: 5 },
  stopTimesHref: { type: String as PropType<string | null>, default: null },
  fitKey: { type: String as PropType<string | null>, default: null },
  highlightRouteId: { type: String as PropType<string | null>, default: null }
})

const emit = defineEmits<{
  (e: 'ready'): void
}>()

const container = ref<HTMLElement>()
let map: maplibregl.Map | null = null
let loaded = false

const LINES_SOURCE = 'gtfs-shapes'
const STOPS_SOURCE = 'gtfs-stops'
const VEHICLES_SOURCE = 'gtfs-vehicles'
const LINES_LAYER = 'gtfs-lines'
const LINES_HIT_LAYER = 'gtfs-lines-hit'
const STOPS_LAYER = 'gtfs-stops-circle'
const STOPS_LABELS_LAYER = 'gtfs-stops-labels'
const VEHICLES_LAYER = 'gtfs-vehicles-circle'

const emptyFc = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

// expressions maplibre : tableaux typés « large » pour contourner les unions d'expressions
const lineColor = ['get', 'color'] as any
const lineWidthExpr = () => ([
  'interpolate', ['linear'], ['zoom'],
  10, Math.max(1, props.lineWidth * 0.35),
  15, props.lineWidth
]) as any
const stopRadiusExpr = () => ([
  'interpolate', ['linear'], ['zoom'],
  11, Math.max(1.5, props.stopRadius * 0.45),
  15, props.stopRadius
]) as any

function beforeLayerId (): string | undefined {
  // insère les données sous les labels du fond de carte pour rester lisibles
  return map?.getStyle()?.layers?.find(l => l.type === 'symbol')?.id
}

function addSourcesAndLayers () {
  if (!map) return
  const before = beforeLayerId()

  const ensureSource = (id: string, data: FeatureCollection) => {
    if (map!.getSource(id)) {
      (map!.getSource(id) as GeoJSONSource).setData(data)
    } else {
      map!.addSource(id, { type: 'geojson', data })
    }
  }
  ensureSource(LINES_SOURCE, props.shapes ?? emptyFc())
  ensureSource(STOPS_SOURCE, props.stops ?? emptyFc())
  ensureSource(VEHICLES_SOURCE, props.vehicles ?? emptyFc())

  const addLayer = (layer: maplibregl.LayerSpecification, before?: string) => {
    if (map!.getLayer(layer.id)) return
    map!.addLayer(layer, before)
  }

  // couche de hit invisible : la ligne visible est trop fine pour cliquer facilement
  addLayer({
    id: LINES_HIT_LAYER,
    type: 'line',
    source: LINES_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-opacity': 0,
      'line-width': (['interpolate', ['linear'], ['zoom'], 10, props.lineWidth * 2.5, 15, Math.max(16, props.lineWidth * 4)]) as any
    }
  }, before)

  addLayer({
    id: LINES_LAYER,
    type: 'line',
    source: LINES_SOURCE,
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: {
      'line-color': lineColor,
      'line-width': lineWidthExpr(),
      'line-opacity': 0.9
    }
  }, LINES_HIT_LAYER)

  const style = map.getStyle() as StyleSpecification | undefined
  const hasGlyphs = !!style?.glyphs
  if (hasGlyphs) {
    addLayer({
      id: STOPS_LABELS_LAYER,
      type: 'symbol',
      source: STOPS_SOURCE,
      minzoom: 14,
      layout: {
        'text-field': ['get', 'stop_name'],
        'text-size': 11,
        'text-offset': [0, 1.1],
        'text-anchor': 'top',
        'text-optional': true
      },
      paint: {
        'text-halo-color': '#ffffff',
        'text-halo-width': 1.5,
        'text-color': '#333333'
      }
    }, before)
  }

  addLayer({
    id: STOPS_LAYER,
    type: 'circle',
    source: STOPS_SOURCE,
    paint: {
      'circle-color': '#ffffff',
      'circle-radius': stopRadiusExpr(),
      'circle-stroke-color': '#37474F',
      'circle-stroke-width': (['interpolate', ['linear'], ['zoom'], 11, 0.8, 15, 1.8]) as any
    }
  }, hasGlyphs ? STOPS_LABELS_LAYER : before)

  addLayer({
    id: VEHICLES_LAYER,
    type: 'circle',
    source: VEHICLES_SOURCE,
    paint: {
      'circle-color': lineColor,
      'circle-radius': (['interpolate', ['linear'], ['zoom'], 10, 3.5, 16, 10]) as any,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5
    }
  }, STOPS_LAYER)

  applyVisibility()
  applyHighlight()
  if (!loaded) {
    loaded = true
    fitNetwork()
    emit('ready')
  }
}

function applyVisibility () {
  if (!map) return
  const set = (layer: string, visible: boolean) => {
    if (map?.getLayer(layer)) map.setLayoutProperty(layer, 'visibility', visible ? 'visible' : 'none')
  }
  set(LINES_LAYER, props.showLines)
  set(LINES_HIT_LAYER, props.showLines)
  set(STOPS_LAYER, props.showStops)
  set(STOPS_LABELS_LAYER, props.showStops && props.showStopLabels)
  set(VEHICLES_LAYER, props.showVehicles)
}

function applyHighlight () {
  if (!map) return
  const filter: any = props.highlightRouteId
    ? ['==', ['get', 'route_id'], props.highlightRouteId]
    : true
  for (const layer of [LINES_LAYER, LINES_HIT_LAYER]) {
    if (map.getLayer(layer)) map.setFilter(layer, filter)
  }
  if (props.highlightRouteId) {
    const route = props.routeIndex.get(props.highlightRouteId)
    if (route) {
      const bounds = routeBounds(props.highlightRouteId)
      if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
    }
  }
}

/** Aplati les coordonnées d'une géométrie en liste de positions. */
function featureCoords (geometry: Feature['geometry']): number[][] {
  switch (geometry.type) {
    case 'Point': return [geometry.coordinates]
    case 'MultiPoint': return geometry.coordinates
    case 'LineString': return geometry.coordinates
    case 'MultiLineString': return geometry.coordinates.flat()
    case 'Polygon': return geometry.coordinates.flat()
    case 'MultiPolygon': return geometry.coordinates.flat(2)
    default: return []
  }
}

function routeBounds (routeId: string): LngLatBoundsLike | null {
  const b = [Infinity, Infinity, -Infinity, -Infinity]
  for (const feature of props.shapes?.features ?? []) {
    if ((feature.properties as any)?.route_id !== routeId) continue
    for (const [x, y] of featureCoords(feature.geometry)) {
      if (x < b[0]) b[0] = x
      if (y < b[1]) b[1] = y
      if (x > b[2]) b[2] = x
      if (y > b[3]) b[3] = y
    }
  }
  if (b[0] === Infinity) return null
  return [[b[0], b[1]], [b[2], b[3]]] as LngLatBoundsLike
}

function fitNetwork () {
  const fc = props.shapes?.features.length ? props.shapes : props.stops
  if (!fc?.features.length || !map) return
  const bounds = new maplibregl.LngLatBounds()
  for (const feature of fc.features) {
    for (const c of featureCoords(feature.geometry)) bounds.extend(c as [number, number])
  }
  map.fitBounds(bounds, { padding: 30, maxZoom: 14, duration: 0 })
}

/* ------------------------------------------------------------------ */
/* Popups                                                              */
/* ------------------------------------------------------------------ */

function openPopup (component: any, componentProps: any, lngLat: maplibregl.LngLatLike) {
  if (!map) return
  const containerEl = document.createElement('div')
  const app = createApp(component, componentProps)
  app.mount(containerEl)
  const popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px', offset: 8 })
    .setLngLat(lngLat)
    .setDOMContent(containerEl)
    .addTo(map)
  popup.on('close', () => app.unmount())
}

function bindInteractions () {
  if (!map) return

  const cursor = (layer: string) => {
    map!.on('mouseenter', layer, () => { if (map) map.getCanvas().style.cursor = 'pointer' })
    map!.on('mouseleave', layer, () => { if (map) map.getCanvas().style.cursor = '' })
  }
  cursor(LINES_HIT_LAYER)
  cursor(STOPS_LAYER)
  cursor(VEHICLES_LAYER)

  map.on('click', LINES_HIT_LAYER, (e) => {
    const feature = e.features?.[0] as MapGeoJSONFeature | undefined
    if (!feature) return
    const p = feature.properties as Record<string, string>
    openPopup(RoutePopup, {
      routeId: p.route_id ?? '',
      shortName: p.route_short_name || p.route_long_name || p.route_id || '',
      longName: p.route_long_name ?? '',
      color: p.color ?? '#1976D2'
    }, e.lngLat)
  })

  map.on('click', STOPS_LAYER, (e) => {
    const feature = e.features?.[0] as MapGeoJSONFeature | undefined
    if (!feature) return
    const p = feature.properties as Record<string, string>
    openPopup(StopPopup, {
      stopId: p.stop_id ?? '',
      stopName: p.stop_name ?? '',
      routes: p.routes ?? '',
      stopTimesHref: props.stopTimesHref
    }, e.lngLat)
  })

  map.on('click', VEHICLES_LAYER, (e) => {
    const feature = e.features?.[0] as MapGeoJSONFeature | undefined
    if (!feature) return
    const p = feature.properties as unknown as VehicleProperties
    openPopup(VehiclePopup, { vehicle: p }, e.lngLat)
  })
}

onMounted(() => {
  if (!container.value) return
  map = new maplibregl.Map({
    container: container.value,
    style: props.styleUrl,
    attributionControl: false
  })
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  // style.load se déclenche au chargement initial et après chaque setStyle (changement de fond)
  map.on('style.load', () => {
    loaded = false
    addSourcesAndLayers()
    bindInteractions()
  })
})

onBeforeUnmount(() => {
  map?.remove()
  map = null
})

watch(() => props.styleUrl, () => {
  map?.setStyle(props.styleUrl)
})
watch(() => props.shapes, () => {
  const source = map?.getSource(LINES_SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(props.shapes ?? emptyFc())
  if (props.shapes?.features.length && loaded) fitNetwork()
})
watch(() => props.stops, () => {
  const source = map?.getSource(STOPS_SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(props.stops ?? emptyFc())
})
watch(() => props.vehicles, () => {
  const source = map?.getSource(VEHICLES_SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(props.vehicles ?? emptyFc())
})
watch(() => [props.showLines, props.showStops, props.showStopLabels, props.showVehicles], applyVisibility)
watch(() => props.lineWidth, () => map?.setPaintProperty(LINES_LAYER, 'line-width', lineWidthExpr() as any))
watch(() => props.stopRadius, () => map?.setPaintProperty(STOPS_LAYER, 'circle-radius', stopRadiusExpr() as any))
watch(() => props.highlightRouteId, applyHighlight)

// recentrage sur le réseau quand la famille de jeux change
watch(() => props.fitKey, () => {
  if (loaded) fitNetwork()
})
</script>

<template>
  <div
    ref="container"
    class="gtfs-map"
  />
</template>

<style scoped>
.gtfs-map {
  position: absolute;
  inset: 0;
}
</style>
