<script setup lang="ts">
import { ref, watch } from 'vue'
import { mdiMapLegend, mdiSelectionMarker } from '@mdi/js'
import type { FeatureCollection, Point } from 'geojson'
import SelectionDetails from './sections/selection-details.vue'
import MapLegend from './sections/map-legend.vue'
import type { RouteInfo } from '@/composables/gtfs.js'
import type { Selection } from '@/composables/selection.js'
import type { VehicleProperties } from '@/composables/use-vehicles.js'

const props = defineProps<{
  title: string
  routes: RouteInfo[]
  hasVehicles: boolean
  lastUpdated: number | null
  realtimeMessage: string | null
  vehicleCount: number
  selectedRouteId: string | null
  selection: Selection | null
  routeIndex: Map<string, RouteInfo>
  stopTimesHref: string | null
  vehicles: FeatureCollection<Point, VehicleProperties> | null
}>()

const emit = defineEmits<{
  (e: 'select-route', routeId: string | null): void
}>()

const SELECTION_PANEL = 0
const LEGEND_PANEL = 1

const panels = ref<number[]>([LEGEND_PANEL])

// la section Sélection s'ouvre à la sélection (y compris restaurée de l'URL au
// montage) et se referme quand elle est vidée
watch(() => props.selection, (value) => {
  if (value) {
    if (!panels.value.includes(SELECTION_PANEL)) panels.value.push(SELECTION_PANEL)
  } else {
    panels.value = panels.value.filter(v => v !== SELECTION_PANEL)
  }
}, { immediate: true })
</script>

<template>
  <v-expansion-panels
    v-model="panels"
    class="navigation-side"
    multiple
    variant="accordion"
    flat
  >
    <v-expansion-panel :disabled="!selection">
      <v-expansion-panel-title>
        <h3>
          <v-icon :icon="mdiSelectionMarker" />&nbsp;
          Sélection
        </h3>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <selection-details
          :selection="selection"
          :route-index="routeIndex"
          :stop-times-href="stopTimesHref"
          :vehicles="vehicles"
        />
      </v-expansion-panel-text>
    </v-expansion-panel>
    <v-expansion-panel>
      <v-divider />
      <v-expansion-panel-title>
        <h3>
          <v-icon :icon="mdiMapLegend" />&nbsp;
          Légende
        </h3>
      </v-expansion-panel-title>
      <v-expansion-panel-text>
        <map-legend
          :title="title"
          :routes="routes"
          :has-vehicles="hasVehicles"
          :last-updated="lastUpdated"
          :realtime-message="realtimeMessage"
          :vehicle-count="vehicleCount"
          :selected-route-id="selectedRouteId"
          @select-route="emit('select-route', $event)"
        />
      </v-expansion-panel-text>
    </v-expansion-panel>
  </v-expansion-panels>
</template>
