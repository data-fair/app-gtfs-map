import { computed, ref, watch } from 'vue'
import { useConfig } from './config.js'
import { fetchJson } from './http.js'
import {
  classifyDataset,
  datasetDocUrl,
  findRealtimeUrl,
  hasRealtimeAttachment,
  kindToConfigField,
  linksBackTo,
  type LinkedRef,
  type MetadataDoc,
  type ResourceKind
} from './gtfs.js'

/**
 * Résout la famille de jeux de données du traitement GTFS :
 * quand le jeu sélectionné change, les 3 jeux liés (tracés, arrêts, horaires) sont détectés
 * via relatedDatasets et l'URL du flux GTFS-RT est découverte dans les pièces jointes
 * distantes du jeu porteur (le jeu de métadonnées, sans données).
 *
 * Le résultat est utilisé localement (dev, app publiée avant configuration) et, en mode
 * draft, poussé vers l'UI DataFair par messages set-config pour remplir les champs cachés
 * de la configuration.
 */
export function useFamily () {
  const { config, notifyConfigChange, application } = useConfig()

  const metadataDataset = computed(() => (config.value as any)?.datasets?.[0])

  // valeur effective = champ de configuration s'il existe, sinon détection locale
  const localLinked = ref<Partial<Record<ResourceKind, LinkedRef>>>({})
  const localRealtimeUrl = ref<string | null>(null)

  const linkedDataset = (kind: ResourceKind) => computed(() =>
    (config.value as any)?.gtfsMap?.[kindToConfigField(kind)] ?? localLinked.value[kind] ?? null)
  const shapesDataset = linkedDataset('shapes')
  const stopsDataset = linkedDataset('stops')
  const stopTimesDataset = linkedDataset('stop-times')
  const realtimeUrl = computed(() => (config.value as any)?.realtime?.url ?? localRealtimeUrl.value)

  // état de la détection, pour l'erreur affichée quand la famille est introuvable
  const resolved = ref(false)
  const error = ref<string | null>(null)

  let resolving = false

  // ordre stable des jeux liés dans configuration.datasets
  const LINKED_ORDER: ResourceKind[] = ['shapes', 'stops', 'stop-times']
  const datasetKey = (datasets: any[]) => datasets.map(d => `${d?.id ?? ''}|${d?.href ?? ''}`).join(',')

  async function resolve () {
    const dataset = metadataDataset.value
    if ((!dataset?.href && !dataset?.id) || resolving) return
    resolving = true
    error.value = null
    try {
      const selfHref = dataset.href ?? datasetDocUrl(application.apiUrl, dataset.id)
      const selfDoc: MetadataDoc = await fetchJson(selfHref)
      const related = selfDoc.relatedDatasets ?? []
      const selectedId = dataset.id as string | undefined

      // document de chaque jeu candidat, pour le classer par schéma. Les liens
      // bidirectionnels (posés par le traitement) priment sur un lien ajouté à la main.
      const found = new Map<ResourceKind, LinkedRef>()
      const fallback = new Map<ResourceKind, LinkedRef>()
      // le jeu sélectionné est-il déjà porteur d'une pièce jointe distante (flux RT) ?
      let carrierDoc: MetadataDoc | null = hasRealtimeAttachment(selfDoc) ? selfDoc : null
      let carrierFallback: MetadataDoc | null = null
      await Promise.all(related.map(async (rel) => {
        if (!rel?.id) return
        try {
          const doc = await fetchJson<any>(datasetDocUrl(application.apiUrl, rel.id))
          const kind = classifyDataset(doc)
          const linkedRef: LinkedRef = {
            id: doc.id ?? rel.id,
            href: doc.href ?? datasetDocUrl(application.apiUrl, rel.id),
            title: doc.title ?? rel.id
          }
          if (kind) {
            const target = linksBackTo(doc, selectedId) ? found : fallback
            if (!target.has(kind) && !found.has(kind)) target.set(kind, linkedRef)
          } else if (hasRealtimeAttachment(doc)) {
            if (linksBackTo(doc, selectedId)) {
              if (!carrierDoc) carrierDoc = doc
            } else if (!carrierFallback) {
              carrierFallback = doc
            }
          }
        } catch {
          // un jeu lié indisponible n'empêche pas d'afficher les autres couches
        }
      }))
      // un schéma seul reste un indice de repli quand aucun lien retour n'est disponible
      for (const [kind, linkedRef] of fallback) {
        if (!found.has(kind)) found.set(kind, linkedRef)
      }
      if (!carrierDoc) carrierDoc = carrierFallback

      localLinked.value = Object.fromEntries(found) as Partial<Record<ResourceKind, LinkedRef>>
      for (const [kind, linkedRef] of found) {
        const field = `gtfsMap.${kindToConfigField(kind)}`
        const current = (config.value as any)?.gtfsMap?.[kindToConfigField(kind)]
        if (current?.id !== linkedRef.id || current?.href !== linkedRef.href) {
          notifyConfigChange(field, linkedRef)
        }
      }

      // La famille complète est aussi référencée dans configuration.datasets : data-fair
      // n'accorde le contournement de permissions de la clé d'application qu'aux jeux
      // listés dans datasets (application-key.ts), pas aux champs cachés gtfsMap.*.
      // L'entrée de métadonnées est réduite aux propriétés déclarées par le schéma :
      // les propriétés injectées au runtime (slug, userPermissions, ...) déclencheraient
      // la validation additionalProperties:false du formulaire de configuration.
      const linkedEntries = LINKED_ORDER
        .map(kind => found.get(kind))
        .filter((entry): entry is LinkedRef => !!entry)
      if (linkedEntries.length) {
        const metadataRef: Record<string, unknown> = { id: dataset.id }
        for (const key of ['href', 'title', 'schema', 'finalizedAt']) {
          if (dataset[key] !== undefined) metadataRef[key] = dataset[key]
        }
        const desired = [metadataRef, ...linkedEntries]
        const current = ((config.value as any)?.datasets ?? []) as any[]
        if (datasetKey(current) !== datasetKey(desired)) {
          notifyConfigChange('datasets', desired)
        }
      }

      // flux temps réel : pièce jointe distante du jeu porteur
      const detected = carrierDoc ? findRealtimeUrl(carrierDoc) : null
      localRealtimeUrl.value = detected
      if (detected && detected !== (config.value as any)?.realtime?.autoDetectedUrl) {
        notifyConfigChange('realtime.autoDetectedUrl', detected)
        // n'écrase pas une URL saisie manuellement (différente de la dernière auto-détection)
        const currentUrl = (config.value as any)?.realtime?.url
        if (!currentUrl || currentUrl === (config.value as any)?.realtime?.autoDetectedUrl) {
          notifyConfigChange('realtime.url', detected)
        }
      }

      resolved.value = true
    } catch {
      // le jeu est peut-être en cours de finalisation : erreur remontée seulement si
      // aucune couche n'est déjà disponible dans la configuration
      error.value = 'Impossible de charger les jeux de données liés. Le jeu sélectionné est peut-être en cours de finalisation.'
    } finally {
      resolving = false
    }
  }

  // une clé stable (id + href) évite de repartir sur le simple echo set-config du draft
  watch(() => `${metadataDataset.value?.id}|${metadataDataset.value?.href}`, resolve, { immediate: true })

  return { metadataDataset, shapesDataset, stopsDataset, stopTimesDataset, realtimeUrl, resolved, error }
}
