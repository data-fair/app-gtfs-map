<script setup lang="ts">
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBadge from '../route-badge.vue'

const { t } = useI18n()

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
    <div class="d-flex ga-2 align-center mb-1">
      <RouteBadge
        :route-name="shortName"
        :color="color"
      />
      <strong>{{ t('route', { name: shortName }) }}</strong>
    </div>
    <div class="text-body-medium text-medium-emphasis">
      {{ subtitle }}
    </div>
  </div>
</template>

<i18n lang="yaml">
fr:
  route: Ligne {name}
en:
  route: Route {name}
</i18n>
