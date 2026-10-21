<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import RouteBadge from '../route-badge.vue'
import { colorsByShortName, loadDepartures, type Departure, type RouteInfo } from '@/composables/gtfs.js'

const { t } = useI18n()

const props = defineProps<{
  stopId: string
  stopName: string
  routes: string[]
  routeIndex: Map<string, RouteInfo>
  stopTimesHref: string | null
  allowedRouteNames: Set<string> | null
}>()

// les arrêts et les horaires portent le nom court de ligne, pas route_id
const colors = computed(() => colorsByShortName(props.routeIndex))
const routeColor = (name: string) => colors.value.get(name) ?? '#607D8B'

const departures = ref<Departure[] | null>(null)
const loadError = ref(false)

onMounted(async () => {
  if (!props.stopTimesHref || !props.stopId) return
  try {
    departures.value = await loadDepartures(props.stopTimesHref, props.stopId, new Date(), props.allowedRouteNames)
  } catch {
    loadError.value = true
  }
})
</script>

<template>
  <div class="gtfs-details">
    <div class="font-weight-bold mb-1">
      {{ stopName || t('stop') }}
    </div>
    <div
      v-if="routes.length"
      class="text-body-medium text-medium-emphasis mb-1"
    >
      <RouteBadge
        v-for="route in routes.slice(0, 12)"
        :key="route"
        :route-name="route"
        :color="routeColor(route)"
        class="mr-1"
      />
    </div>
    <template v-if="stopTimesHref">
      <div class="text-label-small text-uppercase text-medium-emphasis mt-2">
        {{ t('departures') }}
      </div>
      <div
        v-if="loadError"
        class="text-body-medium text-medium-emphasis mb-1"
      >
        {{ t('unavailable') }}
      </div>
      <div
        v-else-if="departures === null"
        class="text-body-medium text-medium-emphasis mb-1"
      >
        {{ t('loading') }}
      </div>
      <div
        v-else-if="!departures.length"
        class="text-body-medium text-medium-emphasis mb-1"
      >
        {{ t('none') }}
      </div>
      <div
        v-else
        class="d-flex flex-column ga-1"
      >
        <div
          v-for="(departure, i) in departures"
          :key="i"
          class="d-flex align-center ga-2 text-body-medium"
        >
          <strong class="departure-time">{{ departure.time }}</strong>
          <RouteBadge
            v-if="departure.routeName"
            :route-name="departure.routeName"
            :color="departure.color ?? routeColor(departure.routeName)"
          />
          <span
            v-if="departure.destination"
            class="text-medium-emphasis text-truncate"
          >{{ departure.destination }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
/* aligned columns of times: no Vuetify utility for tabular figures */
.departure-time {
  min-width: 2.8em;
  font-variant-numeric: tabular-nums;
}
</style>

<i18n lang="yaml">
fr:
  stop: Arrêt
  departures: Prochains passages
  unavailable: Horaires indisponibles
  loading: Chargement…
  none: Aucun passage à venir aujourd'hui
en:
  stop: Stop
  departures: Next departures
  unavailable: Timetable unavailable
  loading: Loading…
  none: No more departures today
</i18n>
