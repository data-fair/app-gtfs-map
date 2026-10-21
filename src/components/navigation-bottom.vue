<script setup lang="ts">
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
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
  allowedRouteNames: Set<string> | null
  vehicles: FeatureCollection<Point, VehicleProperties> | null
}>()

const emit = defineEmits<{
  (e: 'select-route', routeId: string | null): void
}>()

const { t } = useI18n()
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

// a selection opens the sheet on its details (restored from the URL on mount too);
// once cleared, back to the legend (the Selection tab then shows its hint)
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
          :allowed-route-names="allowedRouteNames"
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
      :aria-label="t('navigation')"
      :color="sheet ? 'primary' : ''"
    >
      <v-btn
        :value="SELECTION_PANEL"
        style="min-width:120px"
        size="small"
        class="pa-0"
        @click="toggleSheet(SELECTION_PANEL)"
      >
        <span>{{ t('selection') }}</span><v-icon :icon="mdiSelectionMarker" />
      </v-btn>
      <v-btn
        :value="LEGEND_PANEL"
        style="min-width:120px"
        size="small"
        class="pa-0"
        @click="toggleSheet(LEGEND_PANEL)"
      >
        <span>{{ t('legend') }}</span><v-icon :icon="mdiMapLegend" />
      </v-btn>
    </v-bottom-navigation>
  </div>
</template>

<i18n lang="yaml">
fr:
  selection: Sélection
  legend: Légende
  navigation: Navigation principale
en:
  selection: Selection
  legend: Legend
  navigation: Main navigation
</i18n>
