<template>
  <v-app :class="{ 'bg-transparent': embedded }">
    <!-- fixed-height app (df:overflow false): the map fills the frame, embedded or not -->
    <v-main class="h-screen overflow-hidden">
      <v-empty-state
        v-if="displayError"
        :title="t(displayError)"
        :headline="t('incompleteConfig')"
        :icon="mdiBus"
        class="h-100"
      />
      <MapWrapper
        v-else
        :shapes="shapes"
        :stops="stops"
        :vehicles="displayVehicles"
        :route-index="routeIndex"
        :basemap="basemap"
        :line-width="config?.map?.lineWidth ?? 4"
        :stop-radius="config?.map?.stopRadius ?? 5"
        :vehicle-size="config?.map?.vehicleSize ?? 8"
        :fit-key="family.metadataDataset.value?.id ?? null"
        :highlight-route-id="highlightRouteId"
        :title="title"
        :routes="[...routeIndex.values()]"
        :has-vehicles="!!realtimeUrl && realtimeEnabled"
        :last-updated="lastUpdated"
        :realtime-message="realtimeMessage"
        :vehicle-count="vehicleCount"
        :selection="selection"
        :stop-times="family.stopTimesDataset.value ?? null"
        :fallback-color="fallbackColor"
        :allowed-route-names="allowedRouteNames"
        :panel-position="config?.panelPosition === 'left' ? 'left' : 'right'"
        :large-panel="config?.largePanel === true"
        @ready="mapReady = true"
        @select="select"
        @clear="clear"
        @select-route="selectRoute"
      />
    </v-main>
    <DfUiNotif />
  </v-app>
</template>

<script setup lang="ts">
import type { GeoJsonLayer, LinkedRef } from './composables/gtfs'
import type { Selection } from './composables/selection'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiBus } from '@mdi/js'
import { ofetch } from 'ofetch'
import DfUiNotif from '@data-fair/lib-vuetify/ui-notif.vue'
import { useUiNotif } from '@data-fair/lib-vue/ui-notif.js'
import { isDraftMode, useConfig } from './composables/config'
import reactiveSearchParams from '@data-fair/lib-vue/reactive-search-params-global.js'
import { useFamily } from './composables/use-family'
import { useGeoJsonLayer } from './composables/use-layer'
import {
  applyFallbackColor,
  buildRouteIndex,
  filterFeaturesByRoutes,
  filterPlatformStops,
  filterStopsByRouteNames,
  resolveAllowedRouteIds
} from './composables/gtfs'
import { filterVehiclesByRoutes, useVehicles } from './composables/use-vehicles'
import MapWrapper from './components/map-wrapper.vue'

// embedded, the app lets its host paint the background
const embedded = window.self !== window.top

const { t } = useI18n()
const { config, error } = useConfig()
const { sendUiNotif } = useUiNotif()
const family = useFamily()

/* ------------------------------------------------------------------ */
/* Basemap                                                            */
/* ------------------------------------------------------------------ */

const basemap = computed<string>(() => config.value?.map?.style ?? 'klokantech-basic')

/* ------------------------------------------------------------------ */
/* Static layers loading                                              */
/* ------------------------------------------------------------------ */

const shapesLayer = useGeoJsonLayer(() => family.shapesDataset.value)
const stopsLayer = useGeoJsonLayer(() => family.stopsDataset.value)
const rawShapes = computed(() => shapesLayer.layer.value?.collection ?? null)
const rawStops = computed(() => stopsLayer.layer.value?.collection ?? null)
const shapesStatus = shapesLayer.status
const stopsStatus = stopsLayer.status

const fallbackColor = computed(() => config.value?.map?.fallbackColor ?? '#1976D2')

/* ------------------------------------------------------------------ */
/* Route filter (configuration.routes)                                */
/* ------------------------------------------------------------------ */

// every route present in the raw shapes, to resolve the exclusion mode
const allRouteIds = computed(() => (rawShapes.value?.features ?? [])
  .map(f => (f.properties as Record<string, unknown> | null)?.route_id)
  .filter(id => (typeof id === 'string' || typeof id === 'number') && id !== '')
  .map(String))

const allowedRouteIds = computed(() => resolveAllowedRouteIds(
  config.value?.routes?.mode,
  config.value?.routes?.ids,
  allRouteIds.value
))

const shapes = computed(() => rawShapes.value
  ? filterFeaturesByRoutes(applyFallbackColor(rawShapes.value, fallbackColor.value), 'route_id', allowedRouteIds.value)
  : null)
const routeIndex = computed(() => buildRouteIndex(shapes.value, fallbackColor.value))

// display names of allowed routes (stops and departures carry this name, not route_id)
const allowedRouteNames = computed<Set<string> | null>(() =>
  allowedRouteIds.value ? new Set([...routeIndex.value.values()].map(r => r.shortName)) : null)

const stops = computed(() => filterStopsByRouteNames(filterPlatformStops(rawStops.value), allowedRouteNames.value))

/** Both layer loads are over (success or failure). */
const layersSettled = computed(() =>
  (shapesStatus.value === 'done' || shapesStatus.value === 'error') &&
  (stopsStatus.value === 'done' || stopsStatus.value === 'error') &&
  // until the family is resolved, a still missing `href` is not a final state
  (family.resolved.value || !!family.error.value ||
    !!family.shapesDataset.value?.href || !!family.stopsDataset.value?.href))

function notifyLayer (dataset: LinkedRef | null | undefined, layer: GeoJsonLayer | null, error: unknown) {
  if (error) sendUiNotif({ type: 'error', msg: t('layerError', { title: dataset?.title }), error })
  else if (layer?.truncated) {
    sendUiNotif({ type: 'warning', msg: t('layerTruncated', { title: dataset?.title, count: layer.collection.features.length }) })
  }
}
watch([shapesLayer.layer, shapesLayer.error], ([layer, error]) => notifyLayer(family.shapesDataset.value, layer, error))
watch([stopsLayer.layer, stopsLayer.error], ([layer, error]) => notifyLayer(family.stopsDataset.value, layer, error))

/* ------------------------------------------------------------------ */
/* Realtime vehicles                                                  */
/* ------------------------------------------------------------------ */

const realtimeEnabled = computed(() => config.value?.realtime?.enabled !== false)
const refreshInterval = computed(() => Number(config.value?.realtime?.refreshInterval ?? 15))
const realtimeUrl = computed<string | undefined>(() => family.realtimeUrl.value ?? undefined)

const {
  vehicles,
  lastUpdated,
  status: realtimeStatus,
  error: vehiclesError
} = useVehicles({
  url: realtimeUrl,
  enabled: realtimeEnabled,
  intervalSeconds: refreshInterval,
  routeIndex,
  fallbackColor
})

// vehicles of routes hidden by the configuration are neither shown nor counted
const displayVehicles = computed(() => filterVehiclesByRoutes(vehicles.value, allowedRouteIds.value))

// A fetched feed without positions (empty or TripUpdate) is a frequent source of
// confusion: the legend says so instead of showing "0 vehicles".
const realtimeMessage = computed(() => {
  if (!realtimeUrl.value || !realtimeEnabled.value) return null
  if (realtimeStatus.value === 'trip-update') {
    return t('tripUpdate')
  }
  if (realtimeStatus.value === 'empty') {
    return t('emptyFeed')
  }
  return null
})

watch(realtimeStatus, (value, previous) => {
  if (value === 'trip-update' && previous !== 'trip-update') {
    sendUiNotif({ type: 'warning', msg: realtimeMessage.value ?? '' })
  }
})

watch(vehiclesError, (message) => {
  if (message) sendUiNotif({ type: 'error', msg: t('vehiclesError'), errorMsg: message })
})

/* ------------------------------------------------------------------ */
/* Route selection and panel details                                  */
/* ------------------------------------------------------------------ */

const highlightRouteId = ref<string | null>(reactiveSearchParams.route || null)
// a route restored from the URL opens its details in the panel right away
const selection = ref<Selection | null>(highlightRouteId.value ? { kind: 'route', routeId: highlightRouteId.value } : null)

// selected route persisted in the URL: link sharing and restore on refresh
watch(highlightRouteId, (value) => {
  if (value) reactiveSearchParams.route = value
  else delete reactiveSearchParams.route
})

// route changed from outside (parent page through d-frame sync-params, history): follow it
watch(() => reactiveSearchParams.route, (value) => {
  const routeId = value || null
  if (routeId === highlightRouteId.value) return
  selectRoute(routeId)
})

// stale link (the route no longer exists in the network): do not filter the map down to nothing
watch([routeIndex, highlightRouteId], ([index, id]) => {
  if (id && index.size && !index.has(id)) {
    highlightRouteId.value = null
    if (selection.value?.kind === 'route' && selection.value.routeId === id) selection.value = null
  }
})

watch(() => family.metadataDataset.value?.id, () => {
  highlightRouteId.value = null
  selection.value = null
})

const selectionKey = (value: Selection | null) => !value ? null : value.kind === 'route' ? 'route:' + value.routeId : value.kind === 'stop' ? 'stop:' + value.stopId : 'vehicle:' + value.vehicleId

// map click: details only, no route filter; a click on the selected element deselects it
function select (value: Selection) {
  highlightRouteId.value = null
  selection.value = selectionKey(value) === selectionKey(selection.value) ? null : value
}

// click on empty map or Escape: full deselection (details + legend filter)
function clear () {
  highlightRouteId.value = null
  selection.value = null
}

// legend click: filters the map on the route and opens its details
function selectRoute (routeId: string | null) {
  highlightRouteId.value = routeId
  selection.value = routeId ? { kind: 'route', routeId } : null
}

// the legend counter reflects the active route filter
const vehicleCount = computed(() => {
  if (!highlightRouteId.value) return displayVehicles.value.features.length
  return displayVehicles.value.features.filter(f => f.properties.routeId === highlightRouteId.value).length
})

const mapReady = ref(false)

const familyError = computed(() => {
  const hasLayers = !!family.shapesDataset.value || !!family.stopsDataset.value
  // the resolution error only shows when the configuration has no layers yet
  if (family.error.value && !hasLayers) return family.error.value
  if (!family.resolved.value) return null
  if (!hasLayers) {
    return 'noLinked'
  }
  return null
})

const title = computed(() => {
  const datasetTitle = family.metadataDataset.value?.title ?? ''
  // suffix given by the GTFS processing (French today, English accepted too)
  return datasetTitle.replace(/\s*-\s*(métadonnées|metadata)\s*$/i, '') || t('defaultTitle')
})

const displayError = computed(() => error.value ?? familyError.value ?? undefined)

/* ------------------------------------------------------------------ */
/* Capture (thumbnail and data-fair screenshots)                      */
/* ------------------------------------------------------------------ */

let captureCalled = false
watch([mapReady, lastUpdated, layersSettled, displayError], () => {
  if (captureCalled) return
  // unusable configuration: capture anyway so the service does not wait for its timeout
  if (displayError.value) {
    captureCalled = true
    window.triggerCapture?.(false)
    return
  }
  const hasRealtime = !!realtimeUrl.value && realtimeEnabled.value
  const realtimeSettled = !hasRealtime || lastUpdated.value != null || vehiclesError.value != null
  if (mapReady.value && layersSettled.value && realtimeSettled) {
    captureCalled = true
    // let the fitBounds triggered by the shapes arrival run first
    requestAnimationFrame(() => window.triggerCapture?.(false))
  }
}, { immediate: true })

// configuration error report: draft mode only, otherwise a successful POST
// would put the application in error (cf. POST {application.href}/error contract)
watch(error, (message) => {
  if (message && isDraftMode() && window.parent !== window) {
    ofetch(window.APPLICATION.href + '/error', { method: 'POST', body: { message: t(message) } }).catch(() => {})
  }
}, { immediate: true })
</script>

<i18n lang="yaml">
fr:
  incompleteConfig: Configuration incomplète
  noConfig: Il n'y a pas de configuration définie.
  noDataset: Veuillez sélectionner un jeu de données GTFS.
  familyLoad: Impossible de charger les jeux de données liés. Le jeu sélectionné est peut-être en cours de finalisation.
  noLinked: Aucun jeu lié « tracés » ou « arrêts » n'a été trouvé. Sélectionnez un jeu de données produit par le traitement GTFS.
  defaultTitle: Réseau de transport
  layerError: Échec du chargement de la couche « {title} »
  layerTruncated: La couche « {title} » est incomplète. Seuls les {count} premiers objets sont affichés.
  tripUpdate: Ce flux GTFS-RT est au format TripUpdate. Il ne contient pas de positions de véhicules.
  emptyFeed: Le flux GTFS-RT ne contient aucun véhicule pour le moment.
  vehiclesError: Échec de la récupération des véhicules en temps réel
en:
  incompleteConfig: Incomplete configuration
  noConfig: No configuration is defined.
  noDataset: Please select a GTFS dataset.
  familyLoad: The related datasets could not be loaded. The selected dataset may still be finalizing.
  noLinked: No related "shapes" or "stops" dataset was found. Select a dataset produced by the GTFS processing.
  defaultTitle: Transport network
  layerError: Failed to load the "{title}" layer
  layerTruncated: The "{title}" layer is incomplete. Only the first {count} items are shown.
  tripUpdate: This GTFS-RT feed is in the TripUpdate format. It contains no vehicle positions.
  emptyFeed: The GTFS-RT feed contains no vehicle at the moment.
  vehiclesError: Failed to fetch the real-time vehicles
</i18n>
