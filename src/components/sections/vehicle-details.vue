<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBadge from '../route-badge.vue'
import type { VehicleProperties } from '@/composables/use-vehicles.js'

const { t } = useI18n()

const props = defineProps<{
  vehicle: VehicleProperties
}>()

const ageLabel = computed(() => {
  if (!props.vehicle.timestamp) return t('positionUnknown')
  const seconds = Math.max(0, Math.round(Date.now() / 1000 - props.vehicle.timestamp))
  if (seconds < 60) return t('positionAge', { age: `${seconds} s` })
  if (seconds < 3600) return t('positionAge', { age: `${Math.round(seconds / 60)} min` })
  return t('positionAge', { age: `${Math.round(seconds / 3600)} h` })
})
</script>

<template>
  <div class="gtfs-details">
    <div class="d-flex ga-2 align-center mb-1">
      <RouteBadge
        :route-name="vehicle.routeName || t('bus')"
        :color="vehicle.color"
      />
      <strong>{{ vehicle.label || vehicle.id || t('vehicle') }}</strong>
    </div>
    <div
      v-if="vehicle.speed != null"
      class="text-body-medium text-medium-emphasis"
    >
      {{ t('speed', { speed: vehicle.speed }) }}
    </div>
    <div class="text-body-medium text-medium-emphasis">
      {{ ageLabel }}
    </div>
  </div>
</template>

<i18n lang="yaml">
fr:
  bus: Bus
  vehicle: Véhicule
  speed: "Vitesse : {speed} km/h"
  positionAge: "Position : il y a {age}"
  positionUnknown: "Position : date inconnue"
en:
  bus: Bus
  vehicle: Vehicle
  speed: "Speed: {speed} km/h"
  positionAge: "Position: {age} ago"
  positionUnknown: "Position: unknown time"
</i18n>
