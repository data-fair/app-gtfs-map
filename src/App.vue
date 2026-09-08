<script setup lang="ts">
import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { FeatureCollection } from 'geojson'
import DfUiNotif from '@data-fair/lib-vuetify/ui-notif.vue'
import { useUiNotif } from '@data-fair/lib-vue/ui-notif.js'
import { isDraftMode, useConfig } from './composables/config'
import { useFamily } from './composables/use-family'
import { applyFallbackColor, buildRouteIndex, loadGeoJson, type LinkedRef } from './composables/gtfs'
import { useVehicles } from './composables/use-vehicles'
import GtfsMap from './components/gtfs-map.vue'
import MapOverlay from './components/map-overlay.vue'

const { config, error } = useConfig()
const { sendUiNotif } = useUiNotif()
const family = useFamily()

/* ------------------------------------------------------------------ */
/* Chargement des couches statiques                                    */
/* ------------------------------------------------------------------ */

type LayerStatus = 'idle' | 'loading' | 'done' | 'error'

const rawShapes = shallowRef<FeatureCollection | null>(null)
const rawStops = shallowRef<FeatureCollection | null>(null)
const shapesStatus = ref<LayerStatus>('idle')
const stopsStatus = ref<LayerStatus>('idle')

const fallbackColor = computed(() => (config.value as any)?.map?.fallbackColor ?? '#1976D2')
const shapes = computed(() => rawShapes.value ? applyFallbackColor(rawShapes.value, fallbackColor.value) : null)
const routeIndex = computed(() => buildRouteIndex(shapes.value, fallbackColor.value))

/** Les deux chargements de couches sont terminés (succès ou échec). */
const layersSettled = computed(() =>
  (shapesStatus.value === 'done' || shapesStatus.value === 'error') &&
  (stopsStatus.value === 'done' || stopsStatus.value === 'error') &&
  // tant que la famille n'est pas résolue, un `href` encore absent n'est pas un état final
  (family.resolved.value || !!family.error.value ||
    !!family.shapesDataset.value?.href || !!family.stopsDataset.value?.href))

async function loadLayer (dataset: LinkedRef | undefined, target: typeof rawShapes, status: Ref<LayerStatus>) {
  if (!dataset?.href) {
    target.value = null
    status.value = 'done'
    return
  }
  status.value = 'loading'
  try {
    const { collection, truncated } = await loadGeoJson(dataset.href)
    target.value = collection
    if (truncated) {
      sendUiNotif({
        type: 'warning',
        msg: `La couche « ${dataset.title} » est incomplète : seuls les ${collection.features.length} premiers objets sont affichés.`
      })
    }
    status.value = 'done'
  } catch (err: any) {
    status.value = 'error'
    sendUiNotif({ type: 'error', msg: `Échec du chargement de la couche « ${dataset.title} »`, error: err })
  }
}

// surveille le href (et non l'objet) : l'echo set-config du draft renvoie un nouvel objet
// à chaque sauvegarde, ce qui relancerait inutilement le téléchargement des couches
watch(() => family.shapesDataset.value?.href, () => loadLayer(family.shapesDataset.value, rawShapes, shapesStatus), { immediate: true })
watch(() => family.stopsDataset.value?.href, () => loadLayer(family.stopsDataset.value, rawStops, stopsStatus), { immediate: true })

/* ------------------------------------------------------------------ */
/* Véhicules temps réel                                                */
/* ------------------------------------------------------------------ */

const realtimeEnabled = computed(() => (config.value as any)?.realtime?.enabled !== false)
const refreshInterval = computed(() => Number((config.value as any)?.realtime?.refreshInterval ?? 15))
const realtimeUrl = computed<string | undefined>(() => family.realtimeUrl.value ?? undefined)

const {
  vehicles,
  lastUpdated,
  error: vehiclesError
} = useVehicles({
  url: realtimeUrl,
  enabled: realtimeEnabled,
  intervalSeconds: refreshInterval,
  routeIndex,
  fallbackColor
})

watch(vehiclesError, (message) => {
  if (message) sendUiNotif({ type: 'error', msg: 'Échec de la récupération des véhicules en temps réel', errorMsg: message })
})

/* ------------------------------------------------------------------ */
/* Commandes de vue                                                    */
/* ------------------------------------------------------------------ */

const showLines = ref(true)
const showStops = ref(true)
const showVehicles = ref(true)
const highlightRouteId = ref<string | null>(null)

watch(() => (config.value as any)?.map, (mapConfig) => {
  if (!mapConfig) return
  showLines.value = mapConfig.showLines !== false
  showStops.value = mapConfig.showStops !== false
}, { immediate: true, deep: true })

watch(() => family.metadataDataset.value?.id, () => {
  highlightRouteId.value = null
})

const mapReady = ref(false)
const familyError = computed(() => {
  const hasLayers = !!family.shapesDataset.value || !!family.stopsDataset.value
  // l'erreur de résolution n'est affichée que si la configuration n'a pas déjà des couches
  if (family.error.value && !hasLayers) return family.error.value
  if (!family.resolved.value) return null
  if (!hasLayers) {
    return 'Aucun jeu lié « tracés » ou « arrêts » n\'a été trouvé : sélectionnez un jeu de données produit par le traitement GTFS.'
  }
  return null
})

const title = computed(() => {
  const t = family.metadataDataset.value?.title ?? ''
  return t.replace(/\s*-\s*métadonnées\s*$/i, '') || 'Réseau de transport'
})

const displayError = computed(() => error.value ?? familyError.value ?? undefined)

/* ------------------------------------------------------------------ */
/* Capture (miniature et captures data-fair)                           */
/* ------------------------------------------------------------------ */

let captureCalled = false
watch([mapReady, lastUpdated, layersSettled, displayError], () => {
  if (captureCalled) return
  // configuration inexploitable : capturer quand même pour ne pas attendre le timeout du service
  if (displayError.value) {
    captureCalled = true
    window.triggerCapture?.(false)
    return
  }
  const hasRealtime = !!realtimeUrl.value && realtimeEnabled.value
  const realtimeSettled = !hasRealtime || lastUpdated.value != null || vehiclesError.value != null
  if (mapReady.value && layersSettled.value && realtimeSettled) {
    captureCalled = true
    // laisse passer le fitBounds déclenché par l'arrivée des tracés
    requestAnimationFrame(() => window.triggerCapture?.(false))
  }
}, { immediate: true })

// rapport d'erreur de configuration : uniquement en mode draft, sinon un POST réussi
// ferait passer l'application en erreur (cf. contrat POST {application.href}/error)
watch(error, (message) => {
  if (message && isDraftMode() && window.parent !== window) {
    fetch(window.APPLICATION.href + '/error', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message })
    }).catch(() => {})
  }
}, { immediate: true })
</script>

<template>
  <template v-if="error || familyError">
    <div class="empty-wrap">
      <v-empty-state
        :title="displayError"
        headline="Configuration incomplète"
        icon="mdi-bus"
      />
    </div>
  </template>
  <template v-else>
    <GtfsMap
      :shapes="shapes"
      :stops="rawStops"
      :vehicles="vehicles"
      :route-index="routeIndex"
      :style-url="(config as any)?.map?.styleUrl ?? '/tileserver/styles/klokantech-basic/style.json'"
      :show-lines="showLines"
      :show-stops="showStops"
      :show-stop-labels="(config as any)?.map?.showStopLabels !== false"
      :show-vehicles="showVehicles && !!vehicles.features.length"
      :line-width="(config as any)?.map?.lineWidth ?? 4"
      :stop-radius="(config as any)?.map?.stopRadius ?? 5"
      :stop-times-href="family.stopTimesDataset.value?.href ?? null"
      :fit-key="family.metadataDataset.value?.id ?? null"
      :highlight-route-id="highlightRouteId"
      @ready="mapReady = true"
    />
    <MapOverlay
      v-model:show-lines="showLines"
      v-model:show-stops="showStops"
      v-model:show-vehicles="showVehicles"
      :title="title"
      :routes="[...routeIndex.values()]"
      :has-vehicles="!!realtimeUrl && realtimeEnabled"
      :last-updated="lastUpdated"
      :vehicle-count="vehicles.features.length"
      @select-route="highlightRouteId = $event"
    />
  </template>
  <DfUiNotif />
</template>

<style scoped>
.empty-wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
