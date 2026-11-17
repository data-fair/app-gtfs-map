<template>
  <div>
    <div class="text-title-small mb-1">
      {{ title }}
    </div>
    <div
      v-if="hasVehicles"
      class="d-flex align-center ga-1 pb-1 text-body-small text-medium-emphasis"
    >
      <template v-if="realtimeMessage">
        <v-icon
          :icon="mdiAlertCircleOutline"
          size="x-small"
        />
        {{ realtimeMessage }}
      </template>
      <template v-else-if="lastUpdatedLabel">
        <v-icon
          :icon="mdiClockOutline"
          size="x-small"
        />
        {{ t('vehicles', vehicleCount) }} · {{ lastUpdatedLabel }}
      </template>
      <template v-else>
        {{ t('searching') }}
      </template>
    </div>
    <template v-if="sortedRoutes.length">
      <v-divider class="my-1" />
      <div class="text-label-small text-uppercase text-medium-emphasis">
        {{ t('routes') }}
      </div>
      <template
        v-for="group in routeGroups"
        :key="group.mode ?? 'none'"
      >
        <div
          v-if="group.mode"
          :id="`${uid}-${group.mode}`"
          class="text-label-small text-medium-emphasis pt-1"
        >
          <TransitModeLabel :mode="group.mode" />
        </div>
        <!-- one group per mode, sharing the selection; padding (inside the clipped container) keeps the selection ring whole -->
        <v-chip-group
          :model-value="selectedRouteId"
          class="mx-n1"
          padding="4"
          column
          selected-class="route-item--selected"
          :role="group.mode ? 'group' : undefined"
          :aria-labelledby="group.mode ? `${uid}-${group.mode}` : undefined"
          @update:model-value="selectRoute"
        >
          <RouteBadge
            v-for="route in group.items"
            :key="route.routeId"
            class="route-item"
            :value="route.routeId"
            :route-name="route.shortName"
            :color="route.color"
            role="button"
            :aria-pressed="route.routeId === selectedRouteId"
          />
        </v-chip-group>
      </template>
    </template>
  </div>
</template>

<script setup lang="ts">
import type { RouteInfo } from '@/composables/gtfs.js'
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiAlertCircleOutline, mdiClockOutline } from '@mdi/js'
import { useLocaleDayjs } from '@data-fair/lib-vue/locale-dayjs.js'
import { countModes, groupByMode } from '@/utils/transit-mode'
import RouteBadge from '../route-badge.vue'
import TransitModeLabel from '../transit-mode-label.vue'

const { t, locale } = useI18n()

const props = defineProps<{
  title: string
  routes: RouteInfo[]
  hasVehicles: boolean
  lastUpdated: number | null
  /** message explaining a feed without positions (empty or TripUpdate) */
  realtimeMessage: string | null
  vehicleCount: number
  /** route selected outside the legend (map, URL) */
  selectedRouteId?: string | null
}>()

const emit = defineEmits<{
  (e: 'select-route', routeId: string | null): void
}>()

const sortedRoutes = computed(() => [...props.routes].sort((a, b) => a.shortName.localeCompare(b.shortName, locale.value, { numeric: true })))

const uid = useId()
const { dayjs } = useLocaleDayjs()

// a single-mode network keeps the plain list, without group titles
const showModes = computed(() => countModes(props.routes, r => r.mode ?? null) > 1)
const routeGroups = computed(() => showModes.value
  ? groupByMode(sortedRoutes.value, r => r.mode ?? null)
  : [{ mode: null, items: sortedRoutes.value }])

const lastUpdatedLabel = computed(() => props.lastUpdated ? dayjs(props.lastUpdated).format('HH:mm:ss') : null)

function selectRoute (routeId: string | null | undefined) {
  emit('select-route', routeId ?? null)
}
</script>

<i18n lang="yaml">
fr:
  vehicles: "{n} véhicule | {n} véhicule | {n} véhicules"
  searching: Recherche des véhicules…
  routes: Lignes du réseau
en:
  vehicles: "No vehicle | {n} vehicle | {n} vehicles"
  searching: Looking for vehicles…
  routes: Network routes
</i18n>

<style scoped>
/* selected route: a ring in the text colour, 2px off the chip so the panel surface sets it apart
whatever the route colour; an outline (not a box-shadow) is kept in forced-colors mode */
.route-item--selected {
  outline: 2px solid rgb(var(--v-theme-on-surface));
  outline-offset: 2px;
}
</style>
