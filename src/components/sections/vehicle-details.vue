<script setup lang="ts">
import { computed } from 'vue'
import RouteBadge from '../route-badge.vue'
import type { VehicleProperties } from '@/composables/use-vehicles.js'

const props = defineProps<{
  vehicle: VehicleProperties
}>()

const ageLabel = computed(() => {
  if (!props.vehicle.timestamp) return 'inconnue'
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - props.vehicle.timestamp))
  if (seconds < 60) return `${seconds} s`
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`
  return `${Math.round(seconds / 3600)} h`
})
</script>

<template>
  <div class="gtfs-details">
    <div class="details-header">
      <RouteBadge
        :route-name="vehicle.routeName || 'Bus'"
        :color="vehicle.color"
      />
      <strong>{{ vehicle.label || vehicle.id || 'Véhicule' }}</strong>
    </div>
    <div
      v-if="vehicle.speed != null"
      class="details-line"
    >
      Vitesse : {{ vehicle.speed }} km/h
    </div>
    <div class="details-line">
      Position : il y a {{ ageLabel }}
    </div>
  </div>
</template>

<style scoped>
.details-header {
  display: flex;
  gap: 0.5em;
  align-items: center;
  margin-bottom: 0.25em;
}
.details-line {
  color: #555;
  font-size: 0.85em;
}
</style>
