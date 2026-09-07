<script setup lang="ts">
import { computed, ref } from 'vue'
import dayjs from 'dayjs'
import RouteBadge from './route-badge.vue'
import type { RouteInfo } from '@/composables/gtfs.js'

const props = defineProps<{
  title: string
  routes: RouteInfo[]
  showLines: boolean
  showStops: boolean
  showVehicles: boolean
  hasVehicles: boolean
  lastUpdated: number | null
  vehicleCount: number
}>()

const emit = defineEmits<{
  (e: 'update:showLines', value: boolean): void
  (e: 'update:showStops', value: boolean): void
  (e: 'update:showVehicles', value: boolean): void
  (e: 'select-route', routeId: string | null): void
}>()

const expanded = ref(true)
const selectedRouteId = ref<string | null>(null)

const sortedRoutes = computed(() => [...props.routes].sort((a, b) => a.shortName.localeCompare(b.shortName, 'fr', { numeric: true })))

const lastUpdatedLabel = computed(() => props.lastUpdated ? dayjs(props.lastUpdated).format('HH:mm:ss') : null)

function selectRoute (routeId: string) {
  selectedRouteId.value = selectedRouteId.value === routeId ? null : routeId
  emit('select-route', selectedRouteId.value)
}
</script>

<template>
  <div class="map-overlay">
    <div class="overlay-card">
      <div
        class="overlay-header"
        @click="expanded = !expanded"
      >
        <v-icon
          :icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
          size="small"
        />
        <span class="overlay-title">{{ title }}</span>
      </div>
      <div
        v-if="expanded"
        class="overlay-body"
      >
        <v-switch
          :model-value="showLines"
          label="Lignes"
          density="compact"
          hide-details
          color="primary"
          @update:model-value="emit('update:showLines', !!$event)"
        />
        <v-switch
          :model-value="showStops"
          label="Arrêts"
          density="compact"
          hide-details
          color="primary"
          @update:model-value="emit('update:showStops', !!$event)"
        />
        <v-switch
          v-if="hasVehicles"
          :model-value="showVehicles"
          label="Véhicules en temps réel"
          density="compact"
          hide-details
          color="primary"
          @update:model-value="emit('update:showVehicles', !!$event)"
        />
        <div
          v-if="hasVehicles"
          class="rt-status"
        >
          <template v-if="lastUpdatedLabel">
            <v-icon
              icon="mdi-clock-outline"
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
            @click="selectRoute(route.routeId)"
          >
            <RouteBadge
              :route-name="route.shortName"
              :color="route.color"
            />
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.map-overlay {
  position: absolute;
  top: 8px;
  left: 8px;
  z-index: 5;
  max-width: 260px;
  max-height: calc(100% - 16px);
  display: flex;
  flex-direction: column;
}
.overlay-card {
  background: rgba(255, 255, 255, 0.96);
  border-radius: 8px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.25);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}
.overlay-header {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 8px 12px;
  font-weight: 600;
  cursor: pointer;
  user-select: none;
}
.overlay-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.95em;
}
.overlay-body {
  padding: 0 8px 8px;
  overflow-y: auto;
}
.rt-status {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px 8px;
  font-size: 0.8em;
  color: #555;
}
.routes-list {
  border-top: 1px solid #e0e0e0;
  padding: 8px;
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
