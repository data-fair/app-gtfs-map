import type { FeatureCollection } from 'geojson'
import type { LinkedRef } from './gtfs.js'
import { computed } from 'vue'
import { useFetch } from '@data-fair/lib-vue/fetch.js'
import { geoJsonQuery, toGeoJsonLayer } from './gtfs.js'

export type LayerStatus = 'loading' | 'done' | 'error'

// whole dataset as GeoJSON; the URL is a plain string, so a draft set-config echo does not refetch
export function useGeoJsonLayer (dataset: () => LinkedRef | null | undefined) {
  const href = computed(() => dataset()?.href ?? null)
  const { data, loading, error } = useFetch<FeatureCollection & { total?: number }>(
    () => href.value && `${href.value}/lines`,
    { query: () => geoJsonQuery(dataset()?.finalizedAt), notifError: false }
  )
  const layer = computed(() => href.value && data.value ? toGeoJsonLayer(data.value) : null)
  const status = computed<LayerStatus>(() => {
    if (!href.value) return 'done'
    if (error.value) return 'error'
    return loading.value || !data.value ? 'loading' : 'done'
  })
  return { layer, status, error }
}
