<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch, type PropType } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import * as maplibregl from 'maplibre-gl'
import type { GeoJSONSource, LngLatBoundsLike, MapGeoJSONFeature, StyleSpecification } from 'maplibre-gl'
import type { Feature, FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import reactiveSearchParams from '@data-fair/lib-vue/reactive-search-params-global.js'
import { gtfsInsertBeforeId, type RouteInfo } from '@/composables/gtfs.js'
import type { Selection } from '@/composables/selection.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'

maplibregl.setWorkerUrl(workerUrl)

const props = defineProps({
  shapes: { type: Object as PropType<FeatureCollection | null>, default: null },
  stops: { type: Object as PropType<FeatureCollection | null>, default: null },
  vehicles: { type: Object as PropType<FeatureCollection<Point, VehicleProperties> | null>, default: null },
  routeIndex: { type: Map as PropType<Map<string, RouteInfo>>, required: true },
  styleUrl: { type: String, required: true },
  lineWidth: { type: Number, default: 4 },
  stopRadius: { type: Number, default: 5 },
  vehicleSize: { type: Number, default: 8 },
  fitKey: { type: String as PropType<string | null>, default: null },
  highlightRouteId: { type: String as PropType<string | null>, default: null }
})

const emit = defineEmits<{
  (e: 'ready'): void
  (e: 'select', selection: Selection): void
  (e: 'clear'): void
}>()

const container = ref<HTMLElement>()
let map: maplibregl.Map | null = null
let loaded = false
// distingue le premier chargement d'un rechargement de style (setStyle) :
// ce dernier préserve la caméra maplibre et ne doit pas recentrer sur le réseau
let initialLoad = true
// les handlers liés à une couche survivent à setStyle : ne les enregistrer qu'une fois
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
/* Navigation persistée dans l'URL (lng, lat, zoom)                    */
/* ------------------------------------------------------------------ */

function urlNumber (key: string): number | null {
  const v = Number(reactiveSearchParams[key])
  return Number.isFinite(v) ? v : null
}

// vue complète lue une seule fois au montage : centre/zoom initiaux de la carte
const urlView: { center: [number, number], zoom: number } | null = (() => {
  const lng = urlNumber('lng')
  const lat = urlNumber('lat')
  const zoom = urlNumber('zoom')
  if (lng === null || lat === null || zoom === null) return null
  return { center: [lng, lat], zoom }
})()

// debounce : un geste continu (molette, pincement) émet de nombreux moveend, et
// chaque écriture d'URL envoie un stateChange au parent (portail, dashboard)
const persistView = useDebounceFn(() => {
  if (!map) return
  reactiveSearchParams.lng = map.getCenter().lng.toFixed(6)
  reactiveSearchParams.lat = map.getCenter().lat.toFixed(6)
  reactiveSearchParams.zoom = map.getZoom().toFixed(2)
}, 250)

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
const vehicleRadiusExpr = () => ([
  'interpolate', ['linear'], ['zoom'],
  10, Math.max(2, props.vehicleSize * 0.45),
  16, props.vehicleSize * 1.25
]) as any

function beforeLayerId (): string | undefined {
  // insère les données au-dessus des routes du fond de carte, sous les labels pour rester lisibles
  return gtfsInsertBeforeId(map?.getStyle()?.layers ?? [])
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
      // vue de l'URL si présente (lien partagé / rafraîchissement), sinon cadrage
      // réseau — ou sur la ligne restaurée d'un lien qui ne porte pas de position
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
  // les véhicules portent routeId (camelCase), pas route_id (propriété GTFS des tracés)
  const vehicleFilter: any = props.highlightRouteId
    ? ['==', ['get', 'routeId'], props.highlightRouteId]
    : true
  if (map.getLayer(VEHICLES_LAYER)) map.setFilter(VEHICLES_LAYER, vehicleFilter)
  // cadrage sur la ligne : à la sélection utilisateur, ou à la restauration d'un
  // lien qui porte la ligne sans position. Une vue URL complète prime toujours.
  if (fit && props.highlightRouteId) {
    const bounds = routeBounds(props.highlightRouteId)
    if (bounds) map.fitBounds(bounds, { padding: 60, maxZoom: 14, duration: 600 })
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
/* Sélection                                                           */
/* ------------------------------------------------------------------ */

/** Convertit la feature rendue sous le curseur en sélection pour le panneau. */
function selectionFromFeature (feature: MapGeoJSONFeature): Selection | null {
  const p = feature.properties as Record<string, any>
  switch (feature.layer.id) {
    case VEHICLES_LAYER:
      return { kind: 'vehicle', vehicleId: p.id ?? '', vehicle: p as unknown as VehicleProperties }
    case STOPS_LAYER:
      return { kind: 'stop', stopId: p.stop_id ?? '', stopName: p.stop_name ?? '', routes: p.routes ?? '' }
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

  // un seul handler : la feature la plus haute (véhicule > arrêt > ligne) gagne,
  // et un clic sur la carte vide désélectionne
  map.on('click', (e) => {
    const features = map!.queryRenderedFeatures(e.point, {
      layers: [VEHICLES_LAYER, STOPS_LAYER, LINES_HIT_LAYER]
    })
    const selection = features[0] ? selectionFromFeature(features[0]) : null
    if (selection) emit('select', selection)
    else emit('clear')
  })
}

onMounted(() => {
  if (!container.value) return
  map = new maplibregl.Map({
    container: container.value,
    style: props.styleUrl,
    ...(urlView ?? {}),
    attributionControl: false,
    zoomLevelsToOverscale: undefined
  })
  if (import.meta.env.DEV) window.__MAP__ = map
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right')
  // toute fin de déplacement (pan, zoom, fitBounds) est reportée dans l'URL
  map.on('moveend', persistView)
  // style.load se déclenche au chargement initial et après chaque setStyle (changement de fond)
  map.on('style.load', () => {
    loaded = false
    addSourcesAndLayers()
    bindInteractions()
  })
})

onBeforeUnmount(() => {
  // persiste une éventuelle vue en attente avant de détruire la carte
  persistView.flush()
  map?.remove()
  map = null
  interactionsBound = false
})

watch(() => props.styleUrl, () => {
  map?.setStyle(props.styleUrl)
})
watch(() => props.shapes, () => {
  const source = map?.getSource(LINES_SOURCE) as GeoJSONSource | undefined
  if (source) source.setData(props.shapes ?? emptyFc())
  if (props.shapes?.features.length && loaded) {
    // ligne restaurée depuis l'URL ou sélectionnée : cadrer sur elle une fois
    // les tracés (et donc l'index des lignes) disponibles — sauf si la vue URL
    // complète doit primer
    if (props.highlightRouteId) applyHighlight(!urlView)
    // sinon cadrage réseau, sauf si une vue de l'URL est déjà appliquée
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

// recentrage sur le réseau quand la famille de jeux change
watch(() => props.fitKey, () => {
  if (loaded) fitNetwork()
})
</script>

<template>
  <div
    ref="container"
    class="gtfs-map"
    role="region"
    aria-label="Carte du réseau de transport"
  />
</template>

<style scoped>
.gtfs-map {
  position: absolute;
  inset: 0;
}
</style>
