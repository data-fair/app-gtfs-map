<script setup lang="ts">
import { computed, ref, shallowRef, watch, type Ref } from 'vue'
import type { FeatureCollection } from 'geojson'
import { mdiBus } from '@mdi/js'
import DfUiNotif from '@data-fair/lib-vuetify/ui-notif.vue'
import { useUiNotif } from '@data-fair/lib-vue/ui-notif.js'
import { isDraftMode, useConfig } from './composables/config'
import reactiveSearchParams from '@data-fair/lib-vue/reactive-search-params-global.js'
import { useFamily } from './composables/use-family'
import { applyFallbackColor, buildRouteIndex, filterPlatformStops, loadGeoJson, type LinkedRef } from './composables/gtfs'
import type { Selection } from './composables/selection'
import { useVehicles } from './composables/use-vehicles'
import MapWrapper from './components/map-wrapper.vue'
import styleOverrides from './assets/styles.json'

const { config, error } = useConfig()
const { sendUiNotif } = useUiNotif()
const family = useFamily()

/* ------------------------------------------------------------------ */
/* Fond de carte                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_STYLE = 'klokantech-basic'

const styleUrl = computed(() => {
  const style = (config.value as any)?.map?.style ?? DEFAULT_STYLE
  return (styleOverrides as any)[style] ?? `${window.location.origin}/tileserver/styles/${style}/style.json`
})

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
const stops = computed(() => filterPlatformStops(rawStops.value))
const routeIndex = computed(() => buildRouteIndex(shapes.value, fallbackColor.value))

/** Les deux chargements de couches sont terminés (succès ou échec). */
const layersSettled = computed(() =>
  (shapesStatus.value === 'done' || shapesStatus.value === 'error') &&
  (stopsStatus.value === 'done' || stopsStatus.value === 'error') &&
  // tant que la famille n'est pas résolue, un `href` encore absent n'est pas un état final
  (family.resolved.value || !!family.error.value ||
    !!family.shapesDataset.value?.href || !!family.stopsDataset.value?.href))

async function loadLayer (dataset: LinkedRef | null | undefined, target: typeof rawShapes, status: Ref<LayerStatus>) {
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
/* Sélection d'une ligne et détail dans le panneau                     */
/* ------------------------------------------------------------------ */

const highlightRouteId = ref<string | null>(reactiveSearchParams.route || null)
// la ligne restaurée depuis l'URL ouvre directement son détail dans le panneau
const selection = ref<Selection | null>(highlightRouteId.value ? { kind: 'route', routeId: highlightRouteId.value } : null)

// ligne sélectionnée persistée dans l'URL : partage de lien et restauration au rafraîchissement
watch(highlightRouteId, (value) => {
  if (value) reactiveSearchParams.route = value
  else delete reactiveSearchParams.route
})

// lien périmé (la route n'existe plus dans le réseau) : ne pas filtrer la carte sur du vide
watch([routeIndex, highlightRouteId], ([index, id]) => {
  if (id && index.size && !index.has(id)) {
    highlightRouteId.value = null
    if (selection.value?.kind === 'route' && selection.value.routeId === id) selection.value = null
  }
})

watch(() => family.metadataDataset.value?.id, () => {
  highlightRouteId.value = null
  selection.value = null
})

// clic sur la carte : détail seulement, sans filtre des lignes
function select (value: Selection) {
  highlightRouteId.value = null
  selection.value = value
}

// clic sur la carte vide : désélection complète (détail + filtre de légende)
function clear () {
  highlightRouteId.value = null
  selection.value = null
}

// clic dans la légende : filtre la carte sur la ligne et ouvre son détail
function selectRoute (routeId: string | null) {
  highlightRouteId.value = routeId
  selection.value = routeId ? { kind: 'route', routeId } : null
}

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
  <v-app>
    <v-main>
      <template v-if="error || familyError">
        <div class="empty-wrap">
          <v-empty-state
            :title="displayError"
            headline="Configuration incomplète"
            :icon="mdiBus"
          />
        </div>
      </template>
      <MapWrapper
        v-else
        :shapes="shapes"
        :stops="stops"
        :vehicles="vehicles"
        :route-index="routeIndex"
        :style-url="styleUrl"
        :line-width="(config as any)?.map?.lineWidth ?? 4"
        :stop-radius="(config as any)?.map?.stopRadius ?? 5"
        :vehicle-size="(config as any)?.map?.vehicleSize ?? 8"
        :fit-key="family.metadataDataset.value?.id ?? null"
        :highlight-route-id="highlightRouteId"
        :title="title"
        :routes="[...routeIndex.values()]"
        :has-vehicles="!!realtimeUrl && realtimeEnabled"
        :last-updated="lastUpdated"
        :vehicle-count="vehicles.features.length"
        :selection="selection"
        :stop-times-href="family.stopTimesDataset.value?.href ?? null"
        :panel-position="(config as any)?.panelPosition === 'left' ? 'left' : 'right'"
        :large-panel="(config as any)?.largePanel === true"
        @ready="mapReady = true"
        @select="select"
        @clear="clear"
        @select-route="selectRoute"
      />
    </v-main>
    <DfUiNotif />
  </v-app>
</template>

<style scoped>
.empty-wrap {
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
