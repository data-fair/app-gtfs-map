<template>
  <route-details
    v-if="route"
    :route-id="route.routeId"
    :short-name="route.shortName"
    :long-name="route.longName"
    :color="route.color"
    :mode="showModes ? route.mode : null"
  />
  <stop-details
    v-else-if="stopSelection"
    :key="stopSelection.stopId"
    :stop-id="stopSelection.stopId"
    :stop-name="stopSelection.stopName"
    :routes="stopRoutes"
    :route-index="routeIndex"
    :stop-times="stopTimes"
    :fallback-color="fallbackColor"
    :allowed-route-names="allowedRouteNames"
  />
  <vehicle-details
    v-else-if="vehicle"
    :vehicle="vehicle"
    :mode="showModes ? routeIndex.get(vehicle.routeId)?.mode : null"
  />
  <div
    v-else
    class="text-body-medium text-medium-emphasis"
  >
    {{ t('hint') }}
  </div>
</template>

<script setup lang="ts">
import type { FeatureCollection, Point } from 'geojson'
import type { LinkedRef, RouteInfo } from '@/composables/gtfs.js'
import type { Selection } from '@/composables/selection.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { countModes } from '@/utils/transit-mode'
import RouteDetails from './route-details.vue'
import StopDetails from './stop-details.vue'
import VehicleDetails from './vehicle-details.vue'

const { t } = useI18n()

const props = defineProps<{
  selection: Selection | null
  routeIndex: Map<string, RouteInfo>
  stopTimes: LinkedRef | null
  fallbackColor: string
  allowedRouteNames: Set<string> | null
  vehicles: FeatureCollection<Point, VehicleProperties> | null
}>()

// a single-mode network does not repeat its mode in the details
const showModes = computed(() => countModes(props.routeIndex.values(), r => r.mode ?? null) > 1)

const routeSelection = computed(() => props.selection?.kind === 'route' ? props.selection : null)
const stopSelection = computed(() => props.selection?.kind === 'stop' ? props.selection : null)
const vehicleSelection = computed(() => props.selection?.kind === 'vehicle' ? props.selection : null)

const route = computed(() => routeSelection.value ? props.routeIndex.get(routeSelection.value.routeId) ?? null : null)

// a route hidden by the configuration is not listed in the stop badges
const stopRoutes = computed(() => {
  const routes = stopSelection.value?.routes ?? []
  return props.allowedRouteNames ? routes.filter(name => props.allowedRouteNames!.has(name)) : routes
})

// vehicle resolved in the current feed: speed and freshness follow polling,
// the selection snapshot is the fallback once the vehicle leaves the feed
const vehicle = computed(() => {
  if (!vehicleSelection.value) return null
  const live = props.vehicles?.features.find(f => f.properties.id === vehicleSelection.value!.vehicleId)
  return live?.properties ?? vehicleSelection.value.vehicle
})
</script>

<i18n lang="yaml">
fr:
  hint: Cliquez sur une ligne, un arrêt ou un véhicule de la carte pour afficher son détail.
en:
  hint: Click a route, a stop or a vehicle on the map to show its details.
</i18n>
