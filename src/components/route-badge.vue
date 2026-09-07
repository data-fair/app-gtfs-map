<script setup lang="ts">
defineProps<{
  routeName: string
  color: string
}>()
</script>

<template>
  <span
    class="route-badge"
    :style="{ backgroundColor: color }"
  >{{ routeName }}</span>
</template>

<style scoped>
.route-badge {
  display: inline-block;
  min-width: 2em;
  padding: 0.1em 0.5em;
  border-radius: 1em;
  color: #fff;
  font-weight: 600;
  font-size: 0.85em;
  text-align: center;
  text-shadow: 0 0 2px rgba(0, 0, 0, 0.35);
}
</style>
