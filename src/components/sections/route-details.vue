<script setup lang="ts">
import { computed } from 'vue'
import RouteBadge from '../route-badge.vue'

const props = defineProps<{
  routeId: string
  shortName: string
  longName: string
  color: string
}>()

const subtitle = computed(() => props.longName || props.routeId)
</script>

<template>
  <div class="gtfs-details">
    <div class="details-header">
      <RouteBadge
        :route-name="shortName"
        :color="color"
      />
      <strong>Ligne {{ shortName }}</strong>
    </div>
    <div class="details-line">
      {{ subtitle }}
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
