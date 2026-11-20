import type {
  LinkedRef,
  MetadataDoc,
  ResourceKind
} from './gtfs.js'
import { computed, ref, watch } from 'vue'
import { useFetch } from '@data-fair/lib-vue/fetch.js'
import { useConfig } from './config.js'
import {
  classifyDataset,
  datasetDocUrl,
  familyFromConfig,
  findRealtimeUrl,
  hasRealtimeAttachment,
  isFragmentOf,
  linksBackTo
} from './gtfs.js'

/**
 * Resolves the GTFS processing dataset family: when the selected dataset changes, the
 * 3 related datasets (shapes, stops, departures) are detected through relatedDatasets, or
 * as fragments of the selected dataset (partOf) when the processing grouped them, and
 * the GTFS-RT feed URL is found in the remote attachments of the carrier dataset (the
 * metadata dataset, without data).
 *
 * The full family (metadata dataset + related datasets) is pushed into the root
 * configuration.datasets array via set-config messages, in draft mode: data-fair only grants
 * the application key permission bypass to datasets listed in datasets (application-key.ts).
 * Related datasets are then read back from that array, classified by schema
 * (familyFromConfig). The result is also used locally (dev, app published before
 * configuration).
 */
export function useFamily () {
  const { config, notifyConfigChange, application } = useConfig()

  // configuration.datasets holds the metadata dataset then the related ones, beyond the schema tuple
  const configDatasets = computed(() => config.value?.datasets as unknown as any[] | undefined)
  const metadataDataset = computed(() => configDatasets.value?.[0])

  // effective value = classified datasets array entries, else local detection
  // (immediate after detection, before the draft mode set-config echo)
  const localLinked = ref<Partial<Record<ResourceKind, LinkedRef>>>({})
  const localRealtimeUrl = ref<string | null>(null)

  const linkedDataset = (kind: ResourceKind) => computed(() =>
    familyFromConfig(configDatasets.value)[kind] ?? localLinked.value[kind] ?? null)
  const shapesDataset = linkedDataset('shapes')
  const stopsDataset = linkedDataset('stops')
  const stopTimesDataset = linkedDataset('stop-times')
  const realtimeUrl = computed(() => config.value?.realtime?.url ?? localRealtimeUrl.value)

  // detection state, for the error shown when the family cannot be found
  const resolved = ref(false)
  const error = ref<string | null>(null)

  // last feed URL prefilled by the app: tells a prefilled URL (replaceable when the
  // dataset changes) from a manually entered one (left untouched)
  let lastAutoUrl: string | null = null

  // stable order of related datasets in configuration.datasets
  const LINKED_ORDER: ResourceKind[] = ['shapes', 'stops', 'stop-times']
  const datasetKey = (datasets: any[]) => datasets.map(d => `${d?.id ?? ''}|${d?.href ?? ''}`).join(',')

  // plain string URLs: a draft set-config echo does not refetch
  const selfHref = computed(() => {
    const dataset = metadataDataset.value
    if (!dataset?.href && !dataset?.id) return null
    return (dataset.href as string | undefined) ?? datasetDocUrl(application.apiUrl, dataset.id)
  })
  const self = useFetch<MetadataDoc>(selfHref, { notifError: false })
  const relatedIds = computed(() => (self.data.value?.relatedDatasets ?? [])
    .map(rel => rel?.id).filter((id): id is string => !!id).join(','))
  // every related dataset in one request; an unavailable one is simply missing from the results
  const related = useFetch<{ results?: any[] }>(
    () => relatedIds.value ? datasetDocUrl(application.apiUrl, '').replace(/\/$/, '') : null,
    { query: () => ({ ids: relatedIds.value, size: 50 }), notifError: false }
  )
  // datasets grouped under the selected one by the processing: data-fair fragments, hidden
  // from the default listing and possibly without relatedDatasets links
  const selectedId = computed(() => metadataDataset.value?.id as string | undefined)
  const fragments = useFetch<{ results?: any[] }>(
    () => selectedId.value ? datasetDocUrl(application.apiUrl, '').replace(/\/$/, '') : null,
    { query: () => ({ partOf: `dataset:${selectedId.value}`, size: 50 }), notifError: false }
  )

  function resolve (selfDoc: MetadataDoc, relatedDocs: any[]) {
    const dataset = metadataDataset.value
    const selectedId = dataset?.id as string | undefined

    // Bidirectional links (set by the processing) take precedence over a manually added link.
    const found = new Map<ResourceKind, LinkedRef>()
    const fallback = new Map<ResourceKind, LinkedRef>()
    // does the selected dataset already carry a remote attachment (RT feed)?
    let carrierDoc: MetadataDoc | null = hasRealtimeAttachment(selfDoc) ? selfDoc : null
    let carrierFallback: MetadataDoc | null = null
    for (const doc of relatedDocs) {
      if (!doc?.id) continue
      const kind = classifyDataset(doc)
      if (kind) {
        const linkedRef: LinkedRef = {
          id: doc.id,
          href: doc.href ?? datasetDocUrl(application.apiUrl, doc.id),
          title: doc.title ?? doc.id,
          schema: doc.schema,
          finalizedAt: doc.finalizedAt
        }
        const target = linksBackTo(doc, selectedId) || isFragmentOf(doc, selectedId) ? found : fallback
        if (!target.has(kind) && !found.has(kind)) target.set(kind, linkedRef)
      } else if (hasRealtimeAttachment(doc)) {
        if (linksBackTo(doc, selectedId)) {
          if (!carrierDoc) carrierDoc = doc
        } else if (!carrierFallback) {
          carrierFallback = doc
        }
      }
    }
    // a schema alone stays a fallback hint when no back link is available
    for (const [kind, linkedRef] of fallback) {
      if (!found.has(kind)) found.set(kind, linkedRef)
    }
    if (!carrierDoc) carrierDoc = carrierFallback

    localLinked.value = Object.fromEntries(found) as Partial<Record<ResourceKind, LinkedRef>>

    // The full family is referenced in configuration.datasets: the metadata dataset
    // (entries reduced to the properties declared by the schema, properties injected
    // at runtime would trip the form's additionalProperties:false validation), then
    // the related datasets, which carry their schema to stay classifiable by familyFromConfig.
    const linkedEntries = LINKED_ORDER
      .map(kind => found.get(kind))
      .filter((entry): entry is LinkedRef => !!entry)
      .map(({ id, href, title, schema }) => ({ id, href, title, schema }))
    if (linkedEntries.length && dataset) {
      const metadataRef: Record<string, unknown> = { id: dataset.id }
      for (const key of ['href', 'title', 'schema']) {
        if (dataset[key] !== undefined) metadataRef[key] = dataset[key]
      }
      const desired = [metadataRef, ...linkedEntries]
      const current = configDatasets.value ?? []
      if (datasetKey(current) !== datasetKey(desired)) {
        notifyConfigChange('datasets', desired)
      }
    }

    // realtime feed: remote attachment of the carrier dataset, prefilled in the
    // configuration unless the user manually entered another URL
    const detected = carrierDoc ? findRealtimeUrl(carrierDoc) : null
    localRealtimeUrl.value = detected
    if (detected) {
      const currentUrl = config.value?.realtime?.url
      if ((!currentUrl || currentUrl === lastAutoUrl) && currentUrl !== detected) {
        notifyConfigChange('realtime.url', detected)
      }
      lastAutoUrl = detected
    } else {
      lastAutoUrl = null
    }

    resolved.value = true
  }

  watch([self.data, self.error, self.loading, related.data, related.loading, fragments.data, fragments.loading], () => {
    if (self.error.value) {
      // the dataset may still be finalizing: only reported when no layer is already configured
      error.value = 'familyLoad'
      return
    }
    if (!self.data.value || self.loading.value || related.loading.value || fragments.loading.value) return
    error.value = null
    const relatedDocs = relatedIds.value ? related.data.value?.results ?? [] : []
    // isFragmentOf also guards against a data-fair that ignores the partOf filter
    const fragmentDocs = (fragments.data.value?.results ?? [])
      .filter(doc => isFragmentOf(doc, selectedId.value) && !relatedDocs.some(r => r?.id === doc.id))
    resolve(self.data.value, [...relatedDocs, ...fragmentDocs])
  // post: the related request triggered by a new self document has already started (loading true)
  }, { flush: 'post' })

  return { metadataDataset, shapesDataset, stopsDataset, stopTimesDataset, realtimeUrl, resolved, error }
}
