<script setup lang="ts">
import { computed } from 'vue'
import { contrastTextColor } from '@/composables/gtfs.js'

const props = defineProps<{
  routeName: string
  color: string
}>()

const textColor = computed(() => contrastTextColor(props.color))
</script>

<template>
  <v-chip
    class="route-badge text-label-large font-weight-bold justify-center"
    :color="color"
    :base-color="color"
    :style="{ color: textColor }"
    variant="flat"
    size="x-small"
    rounded="pill"
  >
    <span class="route-badge__text d-inline-block">{{ routeName }}</span>
  </v-chip>
</template>

<style scoped>
/* a one-digit route keeps a pill shape instead of a circle */
.route-badge {
  min-width: 2em;
}
/* centre the digits' ink, not the font box whose descent leaves more room below digits */
.route-badge__text {
  text-box: trim-both cap alphabetic;
}
</style>
