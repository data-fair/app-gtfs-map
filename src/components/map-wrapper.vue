<template>
  <map-panel
    :selected="selection"
    :location="panelPosition"
    :large="largePanel"
    @deselect="emit('clear')"
  >
    <template #default="{ controls, cover }">
      <gtfs-map
        :shapes="shapes"
        :stops="stops"
        :vehicles="vehicles"
        :route-index="routeIndex"
        :basemap="basemap"
        :line-width="lineWidth"
        :stop-radius="stopRadius"
        :vehicle-size="vehicleSize"
        :fit-key="fitKey"
        :highlight-route-id="highlightRouteId"
        :controls="controls"
        :cover="cover"
        :selected="!!selection"
        @ready="emit('ready')"
        @select="emit('select', $event)"
        @clear="emit('clear')"
      />
    </template>
    <template #legend>
      <map-legend
        :title="title"
        :routes="routes"
        :has-vehicles="hasVehicles"
        :last-updated="lastUpdated"
        :realtime-message="realtimeMessage"
        :vehicle-count="vehicleCount"
        :selected-route-id="highlightRouteId"
        @select-route="emit('select-route', $event)"
      />
    </template>
    <template #selection>
      <selection-details
        :selection="selection"
        :route-index="routeIndex"
        :stop-times="stopTimes"
        :fallback-color="fallbackColor"
        :allowed-route-names="allowedRouteNames"
        :vehicles="vehicles"
      />
    </template>
  </map-panel>
</template>

<script setup lang="ts">
import type { FeatureCollection, Point } from 'geojson'
import type { LinkedRef, RouteInfo } from '@/composables/gtfs.js'
import type { Selection } from '@/composables/selection.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'
import GtfsMap from './gtfs-map.vue'
import MapPanel from './map-panel.vue'
import MapLegend from './sections/map-legend.vue'
import SelectionDetails from './sections/selection-details.vue'

defineProps<{
  shapes: FeatureCollection | null
  stops: FeatureCollection | null
  vehicles: FeatureCollection<Point, VehicleProperties> | null
  routeIndex: Map<string, RouteInfo>
  basemap: string
  lineWidth: number
  stopRadius: number
  vehicleSize: number
  fitKey: string | null
  highlightRouteId: string | null
  title: string
  routes: RouteInfo[]
  hasVehicles: boolean
  lastUpdated: number | null
  realtimeMessage: string | null
  vehicleCount: number
  selection: Selection | null
  stopTimes: LinkedRef | null
  fallbackColor: string
  allowedRouteNames: Set<string> | null
  panelPosition: 'left' | 'right'
  largePanel: boolean
}>()

const emit = defineEmits<{
  (e: 'ready'): void
  (e: 'select', selection: Selection): void
  (e: 'clear'): void
  (e: 'select-route', routeId: string | null): void
}>()
</script>
