<script setup lang="ts">
import { onMounted, ref } from 'vue'
import RouteBadge from './route-badge.vue'
import { loadDepartures, type Departure } from '@/composables/gtfs.js'

const props = defineProps<{
  stopId: string
  stopName: string
  routes: string
  stopTimesHref: string | null
}>()

const departures = ref<Departure[] | null>(null)
const loadError = ref(false)

onMounted(async () => {
  if (!props.stopTimesHref || !props.stopId) return
  try {
    departures.value = await loadDepartures(props.stopTimesHref, props.stopId)
  } catch {
    loadError.value = true
  }
})
</script>

<template>
  <div class="gtfs-popup">
    <div class="popup-title">
      {{ stopName || 'Arrêt' }}
    </div>
    <div
      v-if="routes"
      class="popup-line"
    >
      <RouteBadge
        v-for="route in routes.split(';').filter(Boolean).slice(0, 12)"
        :key="route"
        :route-name="route"
        color="#607D8B"
        class="mr-1"
      />
    </div>
    <template v-if="stopTimesHref">
      <div class="popup-section">
        Prochains passages
      </div>
      <div
        v-if="departures === null"
        class="popup-line"
      >
        Chargement…
      </div>
      <div
        v-else-if="loadError"
        class="popup-line"
      >
        Horaires indisponibles
      </div>
      <div
        v-else-if="!departures.length"
        class="popup-line"
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
            :color="departure.color ?? '#607D8B'"
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
.gtfs-popup {
  font-family: inherit;
  min-width: 200px;
}
.popup-title {
  display: flex;
  align-items: center;
  font-weight: 600;
  margin-bottom: 0.25em;
}
.popup-line {
  color: #555;
  font-size: 0.85em;
  margin-bottom: 0.25em;
}
.popup-section {
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
