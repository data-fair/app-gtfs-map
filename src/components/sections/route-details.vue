<template>
  <div>
    <div class="d-flex ga-2 align-center mb-1">
      <RouteBadge
        :route-name="shortName"
        :color="color"
      />
      <span class="font-weight-bold">{{ t('route', { name: shortName }) }}</span>
      <template v-if="mode">
        <span aria-hidden="true">·</span>
        <TransitModeLabel
          class="text-body-medium"
          :mode="mode"
        />
      </template>
    </div>
    <div class="text-body-medium text-medium-emphasis">
      {{ subtitle }}
    </div>
  </div>
</template>

<script setup lang="ts">
import type { TransitMode } from '@/utils/transit-mode'
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBadge from '../route-badge.vue'
import TransitModeLabel from '../transit-mode-label.vue'

const { t } = useI18n()

const props = defineProps<{
  routeId: string
  shortName: string
  longName: string
  color: string
  /** shown only on a multi-mode network */
  mode?: TransitMode | null
}>()

const subtitle = computed(() => props.longName || props.routeId)
</script>

<i18n lang="yaml">
fr:
  route: Ligne {name}
en:
  route: Route {name}
</i18n>
