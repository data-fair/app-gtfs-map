<script setup lang="ts">
import { ref, watch } from 'vue'
import { mdiMapLegend, mdiSelectionMarker } from '@mdi/js'
import { useDisplay } from 'vuetify'
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

const { height } = useDisplay()

const SELECTION_PANEL = 0
const LEGEND_PANEL = 1

const sheet = ref(false)
const tab = ref(LEGEND_PANEL)

function toggleSheet (target: number) {
  const open = !(sheet.value && tab.value === target)
  // le groupe de boutons se désélectionne au clic sur l'onglet actif : on
  // réaffirme l'onglet voulu pour que le contenu de la feuille reste rendu
  tab.value = target
  sheet.value = open
}

// la sélection ouvre la feuille sur le détail (y compris restaurée de l'URL au
// montage) ; quand elle est vidée, on revient à la légende (l'onglet Sélection
// est alors désactivé)
watch(() => props.selection, (value) => {
  if (value) {
    tab.value = SELECTION_PANEL
    sheet.value = true
  } else if (tab.value === SELECTION_PANEL) {
    tab.value = LEGEND_PANEL
    sheet.value = false
  }
}, { immediate: true })
</script>

<template>
  <div class="navigation-bottom">
    <v-bottom-sheet
      v-model="sheet"
      :scrim="false"
      persistent
    >
      <v-sheet
        class="px-3"
        :style="`max-height:${height / 2}px;overflow-y:auto`"
      >
        <selection-details
          v-if="tab === SELECTION_PANEL"
          :selection="selection"
          :route-index="routeIndex"
          :stop-times-href="stopTimesHref"
          :vehicles="vehicles"
        />
        <map-legend
          v-if="tab === LEGEND_PANEL"
          :title="title"
          :routes="routes"
          :has-vehicles="hasVehicles"
          :last-updated="lastUpdated"
          :realtime-message="realtimeMessage"
          :vehicle-count="vehicleCount"
          :selected-route-id="selectedRouteId"
          @select-route="emit('select-route', $event)"
        />
        <div style="height:60px" />
      </v-sheet>
    </v-bottom-sheet>
    <v-bottom-navigation
      v-model="tab"
      style="z-index:3000"
      aria-label="Navigation principale"
      :color="sheet ? 'primary' : ''"
    >
      <v-btn
        :value="SELECTION_PANEL"
        :disabled="!selection"
        style="min-width:120px"
        size="small"
        class="pa-0"
        @click="toggleSheet(SELECTION_PANEL)"
      >
        <span>Sélection</span><v-icon :icon="mdiSelectionMarker" />
      </v-btn>
      <v-btn
        :value="LEGEND_PANEL"
        style="min-width:120px"
        size="small"
        class="pa-0"
        @click="toggleSheet(LEGEND_PANEL)"
      >
        <span>Légende</span><v-icon :icon="mdiMapLegend" />
      </v-btn>
    </v-bottom-navigation>
  </div>
</template>
