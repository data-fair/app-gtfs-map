<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import RouteBadge from '../route-badge.vue'
import { colorsByShortName, loadDepartures, type Departure, type RouteInfo } from '@/composables/gtfs.js'

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
    <div class="details-title">
      {{ stopName || 'Arrêt' }}
    </div>
    <div
      v-if="routes.length"
      class="details-line"
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
      <div class="details-section">
        Prochains passages
      </div>
      <div
        v-if="departures === null"
        class="details-line"
      >
        Chargement…
      </div>
      <div
        v-else-if="loadError"
        class="details-line"
      >
        Horaires indisponibles
      </div>
      <div
        v-else-if="!departures.length"
        class="details-line"
      >
        Aucun passage à venir aujourd'hui
      </div>
      <div
        v-else
        class="departures"
      >
        <div
          v-for="(departure, i) in departures"
          :key="i"
          class="departure"
        >
          <strong class="departure-time">{{ departure.time }}</strong>
          <RouteBadge
            v-if="departure.routeName"
            :route-name="departure.routeName"
            :color="departure.color ?? routeColor(departure.routeName)"
          />
          <span
            v-if="departure.destination"
            class="departure-dest"
          >{{ departure.destination }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<style scoped>
.details-title {
  display: flex;
  align-items: center;
  font-weight: 600;
  margin-bottom: 0.25em;
}
.details-line {
  color: #555;
  font-size: 0.85em;
  margin-bottom: 0.25em;
}
.details-section {
  font-size: 0.75em;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #777;
  margin-top: 0.5em;
  margin-bottom: 0.25em;
}
.departures {
  display: flex;
  flex-direction: column;
  gap: 0.25em;
}
.departure {
  display: flex;
  align-items: center;
  gap: 0.5em;
  font-size: 0.9em;
}
.departure-time {
  min-width: 2.8em;
  font-variant-numeric: tabular-nums;
}
.departure-dest {
  color: #555;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
