<script setup lang="ts">
import { computed } from 'vue'
import { useDisplay } from 'vuetify'
import type { FeatureCollection, Point } from 'geojson'
import GtfsMap from './gtfs-map.vue'
import NavigationSide from './navigation-side.vue'
import NavigationBottom from './navigation-bottom.vue'
import type { RouteInfo } from '@/composables/gtfs.js'
import type { Selection } from '@/composables/selection.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'

const props = defineProps<{
  shapes: FeatureCollection | null
  stops: FeatureCollection | null
  vehicles: FeatureCollection<Point, VehicleProperties> | null
  routeIndex: Map<string, RouteInfo>
  styleUrl: string
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
  stopTimesHref: string | null
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

const { width, height } = useDisplay()

const isMobile = computed(() => width.value < (props.largePanel ? 800 : 600))
const panelCols = computed(() => props.largePanel ? 6 : 4)
const panelColsLg = computed(() => props.largePanel ? 5 : 3)
const panelColsXl = computed(() => props.largePanel ? 4 : 2)
const mapCols = computed(() => 12 - panelCols.value)
const mapColsLg = computed(() => 12 - panelColsLg.value)
const mapColsXl = computed(() => 12 - panelColsXl.value)
</script>

<template>
  <template v-if="isMobile">
    <div
      class="map-host"
      :style="`height:${height - 56}px`"
    >
      <gtfs-map
        :shapes="shapes"
        :stops="stops"
        :vehicles="vehicles"
        :route-index="routeIndex"
        :style-url="styleUrl"
        :line-width="lineWidth"
        :stop-radius="stopRadius"
        :vehicle-size="vehicleSize"
        :fit-key="fitKey"
        :highlight-route-id="highlightRouteId"
        @ready="emit('ready')"
        @select="emit('select', $event)"
        @clear="emit('clear')"
      />
    </div>
    <navigation-bottom
      :title="title"
      :routes="routes"
      :has-vehicles="hasVehicles"
      :last-updated="lastUpdated"
      :realtime-message="realtimeMessage"
      :vehicle-count="vehicleCount"
      :selected-route-id="highlightRouteId"
      :selection="selection"
      :route-index="routeIndex"
      :stop-times-href="stopTimesHref"
      :allowed-route-names="allowedRouteNames"
      :vehicles="vehicles"
      @select-route="emit('select-route', $event)"
    />
  </template>
  <v-row
    v-else
    class="ma-0 ga-0"
    :style="`height:${height}px`"
  >
    <v-col
      v-if="panelPosition === 'left'"
      class="pa-0"
      :cols="panelCols"
      :lg="panelColsLg"
      :xl="panelColsXl"
      :style="`height:${height}px;overflow-y:auto`"
    >
      <navigation-side
        :title="title"
        :routes="routes"
        :has-vehicles="hasVehicles"
        :last-updated="lastUpdated"
        :realtime-message="realtimeMessage"
        :vehicle-count="vehicleCount"
        :selected-route-id="highlightRouteId"
        :selection="selection"
        :route-index="routeIndex"
        :stop-times-href="stopTimesHref"
        :allowed-route-names="allowedRouteNames"
        :vehicles="vehicles"
        @select-route="emit('select-route', $event)"
      />
    </v-col>
    <v-col
      class="pa-0"
      :cols="mapCols"
      :lg="mapColsLg"
      :xl="mapColsXl"
      :style="`height:${height}px`"
    >
      <div
        class="map-host"
        style="height:100%"
      >
        <gtfs-map
          :shapes="shapes"
          :stops="stops"
          :vehicles="vehicles"
          :route-index="routeIndex"
          :style-url="styleUrl"
          :line-width="lineWidth"
          :stop-radius="stopRadius"
          :vehicle-size="vehicleSize"
          :fit-key="fitKey"
          :highlight-route-id="highlightRouteId"
          @ready="emit('ready')"
          @select="emit('select', $event)"
          @clear="emit('clear')"
        />
      </div>
    </v-col>
    <v-col
      v-if="panelPosition !== 'left'"
      class="pa-0"
      :cols="panelCols"
      :lg="panelColsLg"
      :xl="panelColsXl"
      :style="`height:${height}px;overflow-y:auto`"
    >
      <navigation-side
        :title="title"
        :routes="routes"
        :has-vehicles="hasVehicles"
        :last-updated="lastUpdated"
        :realtime-message="realtimeMessage"
        :vehicle-count="vehicleCount"
        :selected-route-id="highlightRouteId"
        :selection="selection"
        :route-index="routeIndex"
        :stop-times-href="stopTimesHref"
        :allowed-route-names="allowedRouteNames"
        :vehicles="vehicles"
        @select-route="emit('select-route', $event)"
      />
    </v-col>
  </v-row>
</template>

<style scoped>
.map-host {
  position: relative;
}
</style>
