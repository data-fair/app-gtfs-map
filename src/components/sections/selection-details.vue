<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import type { FeatureCollection, Point } from 'geojson'
import RouteDetails from './route-details.vue'
import StopDetails from './stop-details.vue'
import VehicleDetails from './vehicle-details.vue'
import type { RouteInfo } from '@/composables/gtfs.js'
import type { Selection } from '@/composables/selection.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'

const { t } = useI18n()

const props = defineProps<{
  selection: Selection | null
  routeIndex: Map<string, RouteInfo>
  stopTimesHref: string | null
  allowedRouteNames: Set<string> | null
  vehicles: FeatureCollection<Point, VehicleProperties> | null
}>()

const routeSelection = computed(() => props.selection?.kind === 'route' ? props.selection : null)
const stopSelection = computed(() => props.selection?.kind === 'stop' ? props.selection : null)
const vehicleSelection = computed(() => props.selection?.kind === 'vehicle' ? props.selection : null)

const route = computed(() => routeSelection.value ? props.routeIndex.get(routeSelection.value.routeId) ?? null : null)

// une ligne masquée par la configuration ne figure pas dans les badges de l'arrêt
const stopRoutes = computed(() => {
  const routes = stopSelection.value?.routes ?? []
  return props.allowedRouteNames ? routes.filter(name => props.allowedRouteNames!.has(name)) : routes
})

// véhicule résolu dans le flux courant : vitesse et fraîcheur suivent le polling,
// l'instantané de sélection sert de repli quand le véhicule quitte le flux
const vehicle = computed(() => {
  if (!vehicleSelection.value) return null
  const live = props.vehicles?.features.find(f => f.properties.id === vehicleSelection.value!.vehicleId)
  return live?.properties ?? vehicleSelection.value.vehicle
})
</script>

<template>
  <route-details
    v-if="route"
    :route-id="route.routeId"
    :short-name="route.shortName"
    :long-name="route.longName"
    :color="route.color"
  />
  <stop-details
    v-else-if="stopSelection"
    :key="stopSelection.stopId"
    :stop-id="stopSelection.stopId"
    :stop-name="stopSelection.stopName"
    :routes="stopRoutes"
    :route-index="routeIndex"
    :stop-times-href="stopTimesHref"
    :allowed-route-names="allowedRouteNames"
  />
  <vehicle-details
    v-else-if="vehicle"
    :vehicle="vehicle"
  />
  <p
    v-else
    class="text-body-medium text-medium-emphasis"
  >
    {{ t('hint') }}
  </p>
</template>

<i18n lang="yaml">
fr:
  hint: Cliquez sur une ligne, un arrêt ou un véhicule de la carte pour afficher son détail.
en:
  hint: Click a route, a stop or a vehicle on the map to show its details.
</i18n>
