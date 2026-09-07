<script setup lang="ts">
import { computed } from 'vue'
import RouteBadge from './route-badge.vue'

const props = defineProps<{
  routeId: string
  shortName: string
  longName: string
  color: string
}>()

const subtitle = computed(() => props.longName || props.routeId)
</script>

<template>
  <div class="gtfs-popup">
    <div class="popup-header">
      <RouteBadge
        :route-name="shortName"
        :color="color"
      />
      <strong>Ligne {{ shortName }}</strong>
    </div>
    <div class="popup-line">
      {{ subtitle }}
    </div>
  </div>
</template>

<style scoped>
.gtfs-popup {
  font-family: inherit;
}
.popup-header {
  display: flex;
  gap: 0.5em;
  align-items: center;
  margin-bottom: 0.25em;
}
.popup-line {
  color: #555;
  font-size: 0.85em;
}
</style>
