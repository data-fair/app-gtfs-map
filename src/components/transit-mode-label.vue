<template>
  <span class="d-inline-flex align-center ga-1">
    <v-icon
      :icon="MODE_ICONS[mode]"
      size="small"
      aria-hidden="true"
    />
    {{ t(mode) }}
  </span>
</template>

<script setup lang="ts">
import type { TransitMode } from '@/utils/transit-mode'
import { useI18n } from 'vue-i18n'
import { MODE_ICONS } from '@/utils/transit-mode'

const { t } = useI18n()

defineProps<{
  mode: TransitMode
}>()
</script>

<i18n lang="yaml">
fr:
  metro: Métro
  tram: Tramway
  train: Train
  bus: Bus
  trolleybus: Trolleybus
  ferry: Ferry
  monorail: Monorail
  funicular: Funiculaire
  aerialLift: Téléphérique
en:
  metro: Metro
  tram: Tram
  train: Train
  bus: Bus
  trolleybus: Trolleybus
  ferry: Ferry
  monorail: Monorail
  funicular: Funicular
  aerialLift: Cable car
</i18n>
