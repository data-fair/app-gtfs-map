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
  <span
    class="route-badge"
    :style="{ backgroundColor: color, color: textColor }"
  >{{ routeName }}</span>
</template>

<style scoped>
.route-badge {
  display: inline-block;
  min-width: 2em;
  padding: 0.1em 0.5em;
  border-radius: 1em;
  font-weight: 600;
  font-size: 0.85em;
  text-align: center;
}
</style>
