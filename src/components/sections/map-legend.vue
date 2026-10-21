<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { mdiAlertCircleOutline, mdiClockOutline } from '@mdi/js'
import dayjs from 'dayjs'
import RouteBadge from '../route-badge.vue'
import type { RouteInfo } from '@/composables/gtfs.js'

const { t } = useI18n()

const props = defineProps<{
  title: string
  routes: RouteInfo[]
  hasVehicles: boolean
  lastUpdated: number | null
  /** message expliquant un flux sans positions (vide ou TripUpdate) */
  realtimeMessage: string | null
  vehicleCount: number
  /** ligne sélectionnée à l'extérieur de la légende (carte, URL) */
  selectedRouteId?: string | null
}>()

const emit = defineEmits<{
  (e: 'select-route', routeId: string | null): void
}>()

const selectedRouteId = ref<string | null>(props.selectedRouteId ?? null)

// la sélection peut changer à l'extérieur (carte, URL, changement de réseau)
watch(() => props.selectedRouteId, (value) => {
  selectedRouteId.value = value ?? null
})

const sortedRoutes = computed(() => [...props.routes].sort((a, b) => a.shortName.localeCompare(b.shortName, 'fr', { numeric: true })))

const lastUpdatedLabel = computed(() => props.lastUpdated ? dayjs(props.lastUpdated).format('HH:mm:ss') : null)

function selectRoute (routeId: string | null | undefined) {
  selectedRouteId.value = routeId ?? null
  emit('select-route', selectedRouteId.value)
}
</script>

<template>
  <div class="map-legend">
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
      <v-chip-group
        :model-value="selectedRouteId"
        column
        selected-class="border-primary border-opacity-100"
        @update:model-value="selectRoute"
      >
        <RouteBadge
          v-for="route in sortedRoutes"
          :key="route.routeId"
          class="route-item"
          :class="{ selected: route.routeId === selectedRouteId }"
          :value="route.routeId"
          :route-name="route.shortName"
          :color="route.color"
          border="md opacity-0"
          role="button"
          :aria-pressed="route.routeId === selectedRouteId"
        />
      </v-chip-group>
    </template>
  </div>
</template>

<i18n lang="yaml">
fr:
  vehicles: "{n} véhicule | {n} véhicule | {n} véhicules"
  searching: Recherche des véhicules…
  routes: Lignes du réseau
en:
  vehicles: "no vehicle | {n} vehicle | {n} vehicles"
  searching: Looking for vehicles…
  routes: Network routes
</i18n>
