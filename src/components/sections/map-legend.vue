<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { mdiClockOutline } from '@mdi/js'
import dayjs from 'dayjs'
import RouteBadge from '../route-badge.vue'
import type { RouteInfo } from '@/composables/gtfs.js'

const props = defineProps<{
  title: string
  routes: RouteInfo[]
  hasVehicles: boolean
  lastUpdated: number | null
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

function selectRoute (routeId: string) {
  selectedRouteId.value = selectedRouteId.value === routeId ? null : routeId
  emit('select-route', selectedRouteId.value)
}
</script>

<template>
  <div class="map-legend">
    <div class="legend-title">
      {{ title }}
    </div>
    <div
      v-if="hasVehicles"
      class="rt-status"
    >
      <template v-if="lastUpdatedLabel">
        <v-icon
          :icon="mdiClockOutline"
          size="x-small"
        />
        {{ vehicleCount }} véhicule{{ vehicleCount > 1 ? 's' : '' }} · {{ lastUpdatedLabel }}
      </template>
      <template v-else>
        Recherche des véhicules…
      </template>
    </div>
    <div
      v-if="sortedRoutes.length"
      class="routes-list"
    >
      <div class="routes-title">
        Lignes du réseau
      </div>
      <button
        v-for="route in sortedRoutes"
        :key="route.routeId"
        class="route-item"
        :class="{ selected: route.routeId === selectedRouteId }"
        type="button"
        :aria-pressed="route.routeId === selectedRouteId"
        @click="selectRoute(route.routeId)"
      >
        <RouteBadge
          :route-name="route.shortName"
          :color="route.color"
        />
      </button>
    </div>
  </div>
</template>

<style scoped>
.legend-title {
  font-weight: 600;
  font-size: 0.95em;
  margin-bottom: 4px;
}
.rt-status {
  display: flex;
  align-items: center;
  gap: 4px;
  padding-bottom: 4px;
  font-size: 0.8em;
  color: #555;
}
.routes-list {
  border-top: 1px solid #e0e0e0;
  padding-top: 8px;
  margin-top: 4px;
}
.routes-title {
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #777;
  margin-bottom: 6px;
}
.route-item {
  display: inline-block;
  margin: 2px;
  padding: 2px;
  border: 2px solid transparent;
  border-radius: 6px;
  background: none;
  cursor: pointer;
}
.route-item.selected {
  border-color: #1976D2;
}
</style>
