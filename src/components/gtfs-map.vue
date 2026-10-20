<template>
  <div
    ref="container"
    class="gtfs-map position-absolute top-0 left-0 w-100 h-100"
  />
</template>

<script setup lang="ts">
import type { GeoJSONSource, LngLatBoundsLike, MapGeoJSONFeature, PaddingOptions, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import type { Selection } from '@/composables/selection.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'
import type { RouteInfo } from '@/composables/gtfs.js'
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useDebounceFn } from '@vueuse/core'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import '@/styles/map-controls.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import reactiveSearchParams from '@data-fair/lib-vue/reactive-search-params-global.js'
import { normalizeStopRoutes } from '@/composables/gtfs.js'
import { basemaps, createBasemapSwitch, credentialsFor, firstSymbolLayer, mapLocale, resolveMapStyle } from '@/utils/map-styles'
import { FoldedAttributionControl } from '@/utils/folded-attribution'
import { applyInitialView, readViewParams, resolveInitialView, writeViewParams } from '@/utils/initial-view'
import { keepInView, withCover } from '@/utils/keep-in-view'

maplibregl.setWorkerUrl(workerUrl)

const props = withDefaults(defineProps<{
  shapes?: FeatureCollection | null
  stops?: FeatureCollection | null
  vehicles?: FeatureCollection<Point, VehicleProperties> | null
  routeIndex: Map<string, RouteInfo>
  basemap: string
  lineWidth?: number
  stopRadius?: number
  vehicleSize?: number
  fitKey?: string | null
  highlightRouteId?: string | null
  // side of the map controls, given by the panel (its own side)
  controls?: 'left' | 'right'
  // something is selected (its details are shown)
  selected?: boolean
  // the part of the map under an overlaying panel, given by the panel
  cover?: Partial<PaddingOptions>
}>(), {
  shapes: null,
  stops: null,
  vehicles: null,
  lineWidth: 4,
  stopRadius: 5,
  vehicleSize: 8,
  fitKey: null,
  highlightRouteId: null,
  controls: 'right',
  selected: false,
  cover: () => ({})
})

const { locale } = useI18n()

const emit = defineEmits<{
  (e: 'ready'): void
  (e: 'select', selection: Selection): void
  (e: 'clear'): void
}>()

const container = ref<HTMLElement>()
let map: maplibregl.Map | null = null
let loaded = false
// tells the first load from a style reload (setStyle): the latter keeps
// the maplibre camera and must not recenter on the network
let initialLoad = true
// layer-bound handlers survive setStyle: register them only once
let interactionsBound = false

const LINES_SOURCE = 'gtfs-shapes'
const STOPS_SOURCE = 'gtfs-stops'
const VEHICLES_SOURCE = 'gtfs-vehicles'
const LINES_LAYER = 'gtfs-lines'
const LINES_HIT_LAYER = 'gtfs-lines-hit'
const STOPS_LAYER = 'gtfs-stops-circle'
const STOPS_LABELS_LAYER = 'gtfs-stops-labels'
const VEHICLES_LAYER = 'gtfs-vehicles-circle'

const emptyFc = (): FeatureCollection => ({ type: 'FeatureCollection', features: [] })

/* ------------------------------------------------------------------ */
/* Navigation persisted in the URL (lng, lat, zoom)                   */
/* ------------------------------------------------------------------ */

// a shared link (lng, lat, zoom), read once on mount; else the highlighted route, then the network
// once loaded, then metropolitan France
const urlView = readViewParams(reactiveSearchParams)

// debounce: a continuous gesture (wheel, pinch) emits many moveend, and
// each URL write sends a stateChange to the parent (portal, dashboard)
// the France view shown before the first fit must never reach a shared link
let viewSettled = !!urlView
const persistView = useDebounceFn(() => {
  if (!map || !viewSettled) return
  writeViewParams(reactiveSearchParams, map.getCenter(), map.getZoom())
}, 250)

// maplibre expressions: loosely typed arrays to work around expression unions
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
const vehicleRadiusExpr = () => ([
  'interpolate', ['linear'], ['zoom'],
  10, Math.max(2, props.vehicleSize * 0.45),
  16, props.vehicleSize * 1.25
]) as any

function addSourcesAndLayers () {
  if (!map) return
  // computed on the basemap layers alone, before any data layer is added
  const before = firstSymbolLayer(map.getStyle()?.layers ?? [])

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

  // invisible hit layer: the visible line is too thin to click easily
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
  const darkBasemap = basemaps.find(b => b.id === currentBasemap())?.dark
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
      // contrast with the basemap, not with the app theme; literal colours: the maplibre
      // canvas cannot read the Vuetify CSS variables
      paint: darkBasemap
        ? { 'text-halo-color': '#212121', 'text-halo-width': 1.5, 'text-color': '#eeeeee' }
        : { 'text-halo-color': '#ffffff', 'text-halo-width': 1.5, 'text-color': '#333333' }
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
      'circle-radius': vehicleRadiusExpr(),
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5
    }
  }, STOPS_LAYER)

  applyHighlight()
  if (!loaded) {
    loaded = true
    if (initialLoad) {
      initialLoad = false
      // URL view if present (shared link / refresh), else fit on the network
      // or on the route restored from a link that carries no position
      if (!urlView) {
        if (props.highlightRouteId) applyHighlight(true)
        else fitNetwork()
      }
    }
    emit('ready')
  }
}

function applyHighlight (fit = false) {
  if (!map) return
  const filter: any = props.highlightRouteId
    ? ['==', ['get', 'route_id'], props.highlightRouteId]
    : true
  for (const layer of [LINES_LAYER, LINES_HIT_LAYER]) {
    if (map.getLayer(layer)) map.setFilter(layer, filter)
  }
  // vehicles carry routeId (camelCase), not route_id (GTFS shapes property)
  const vehicleFilter: any = props.highlightRouteId
    ? ['==', ['get', 'routeId'], props.highlightRouteId]
    : true
  if (map.getLayer(VEHICLES_LAYER)) map.setFilter(VEHICLES_LAYER, vehicleFilter)
  // stops carry the short names of served routes (`routes`), not route_id:
  // resolve the selected route by its short name from the route index
  const route = props.highlightRouteId ? props.routeIndex.get(props.highlightRouteId) : null
  const stopFilter: any = route?.shortName ? ['in', route.shortName, ['get', 'routes']] : true
  for (const layer of [STOPS_LAYER, STOPS_LABELS_LAYER]) {
    if (map.getLayer(layer)) map.setFilter(layer, stopFilter)
  }
  // fit on the route: on user selection, or when restoring a link that
  // carries the route without a position. A full URL view always wins.
  if (fit && props.highlightRouteId) {
    const bounds = routeBounds(props.highlightRouteId)
    if (bounds) {
      map.fitBounds(bounds, { padding: withCover(60, props.cover), maxZoom: 14, duration: 600 })
      viewSettled = true
    }
  }
}

/** Flattens a geometry's coordinates into a list of positions. */
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
  map.fitBounds(bounds, { padding: withCover(30, props.cover), maxZoom: 14, duration: 0 })
  viewSettled = true
}

// a tab opened in the background may skip the first fit: do it when the tab shows up
function onVisible () {
  if (!document.hidden && !viewSettled && loaded) fitNetwork()
}

/* ------------------------------------------------------------------ */
/* Selection                                                          */
/* ------------------------------------------------------------------ */

/** Converts the feature rendered under the cursor into a panel selection. */
function selectionFromFeature (feature: MapGeoJSONFeature): Selection | null {
  const p = feature.properties as Record<string, any>
  switch (feature.layer.id) {
    case VEHICLES_LAYER:
      return { kind: 'vehicle', vehicleId: p.id ?? '', vehicle: p as unknown as VehicleProperties }
    case STOPS_LAYER:
      return { kind: 'stop', stopId: p.stop_id ?? '', stopName: p.stop_name ?? '', routes: normalizeStopRoutes(p.routes) }
    case LINES_HIT_LAYER:
      return p.route_id ? { kind: 'route', routeId: p.route_id } : null
    default:
      return null
  }
}

function bindInteractions () {
  if (!map || interactionsBound) return
  interactionsBound = true

  const cursor = (layer: string) => {
    map!.on('mouseenter', layer, () => { if (map) map.getCanvas().style.cursor = 'pointer' })
    map!.on('mouseleave', layer, () => { if (map) map.getCanvas().style.cursor = '' })
  }
  cursor(LINES_HIT_LAYER)
  cursor(STOPS_LAYER)
  cursor(VEHICLES_LAYER)

  // a single handler: the topmost feature (vehicle > stop > route) wins,
  // and a click on the empty map deselects
  map.on('click', (e) => {
    const features = map!.queryRenderedFeatures(e.point, {
      layers: [VEHICLES_LAYER, STOPS_LAYER, LINES_HIT_LAYER]
    })
    const selection = features[0] ? selectionFromFeature(features[0]) : null
    if (selection) emit('select', selection)
    else emit('clear')
  })
}

// last basemap requested (a failed style falls back to the previous one)
let basemapSwitch: ReturnType<typeof createBasemapSwitch> | null = null
const currentBasemap = () => basemapSwitch?.current() ?? props.basemap

// the tileserver styles carry no IGN attribution: it depends on the basemap
let attribution: maplibregl.AttributionControl | null = null
function setAttribution () {
  if (!map) return
  if (attribution) map.removeControl(attribution)
  attribution = new FoldedAttributionControl({
    compact: true,
    customAttribution: basemaps.find(b => b.id === currentBasemap())?.attribution
  })
  map.addControl(attribution, `bottom-${props.controls}`)
}

let navigation: maplibregl.NavigationControl | null = null
let scale: maplibregl.ScaleControl | null = null
function setControls () {
  if (!map) return
  if (navigation) map.removeControl(navigation)
  if (scale) map.removeControl(scale)
  navigation = new maplibregl.NavigationControl({ showCompass: false })
  scale = new maplibregl.ScaleControl()
  map.addControl(navigation, `top-${props.controls}`)
  map.addControl(scale, `bottom-${props.controls}`)
  setAttribution()
}

onMounted(() => {
  if (!container.value) return
  map = new maplibregl.Map({
    container: container.value,
    style: resolveMapStyle(props.basemap, window.location.origin),
    attributionControl: false,
    locale: mapLocale(locale.value),
    transformRequest: credentialsFor(window.location.origin)
  })
  applyInitialView(map, resolveInitialView({ params: reactiveSearchParams }))
  basemapSwitch = createBasemapSwitch(map, props.basemap, window.location.origin)
  if (import.meta.env.DEV) window.__MAP__ = map
  setControls()
  // every move end (pan, zoom, fitBounds) is reported in the URL
  map.on('moveend', (e) => {
    // a user move settles the view even when nothing could be fitted (unknown route, empty network)
    if (e.originalEvent) viewSettled = true
    persistView()
  })
  const kept = keepInView(map, { selected: () => props.selected, cover: () => props.cover })
  watch(() => props.cover, kept.check)
  document.addEventListener('visibilitychange', onVisible)
  // style.load fires on initial load and after each setStyle (basemap change)
  map.on('style.load', () => {
    loaded = false
    setAttribution()
    addSourcesAndLayers()
    bindInteractions()
  })
})

onBeforeUnmount(() => {
  // persist any pending view before destroying the map
  document.removeEventListener('visibilitychange', onVisible)
  persistView.flush()
  map?.remove()
  map = null
  attribution = null
  navigation = null
  scale = null
  basemapSwitch = null
  interactionsBound = false
})

watch(() => props.controls, setControls)
watch(() => props.basemap, (basemap) => basemapSwitch?.set(basemap))
watch(() => props.shapes, () => {
  const source = map?.getSource(LINES_SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(props.shapes ?? emptyFc())
  if (props.shapes?.features.length && loaded) {
    // route restored from the URL or selected: fit on it once the shapes
    // (hence the route index) are available, unless the full URL view
    // must win
    if (props.highlightRouteId) applyHighlight(!urlView)
    // else fit on the network, unless a URL view is already applied
    else if (!urlView) fitNetwork()
  }
})
watch(() => props.stops, () => {
  const source = map?.getSource(STOPS_SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(props.stops ?? emptyFc())
})
watch(() => props.vehicles, () => {
  const source = map?.getSource(VEHICLES_SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(props.vehicles ?? emptyFc())
})
watch(() => props.lineWidth, () => map?.setPaintProperty(LINES_LAYER, 'line-width', lineWidthExpr() as any))
watch(() => props.stopRadius, () => map?.setPaintProperty(STOPS_LAYER, 'circle-radius', stopRadiusExpr() as any))
watch(() => props.vehicleSize, () => map?.setPaintProperty(VEHICLES_LAYER, 'circle-radius', vehicleRadiusExpr() as any))
watch(() => props.highlightRouteId, () => applyHighlight(true))

// recenter on the network when the dataset family changes
watch(() => props.fitKey, () => {
  if (loaded) fitNetwork()
})
</script>
