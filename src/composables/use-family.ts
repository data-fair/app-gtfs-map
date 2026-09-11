import { computed, ref, watch } from 'vue'
import { useConfig } from './config.js'
import { fetchJson } from './http.js'
import {
  classifyDataset,
  datasetDocUrl,
  familyFromConfig,
  findRealtimeUrl,
  hasRealtimeAttachment,
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
 * La famille complète (jeu de métadonnées + jeux liés) est poussée dans le tableau racine
 * configuration.datasets par messages set-config, en mode draft : data-fair n'accorde le
 * contournement de permissions de la clé d'application qu'aux jeux listés dans datasets
 * (application-key.ts). Les jeux liés sont ensuite relus de ce tableau, classifiés par
 * schéma (familyFromConfig). Le résultat est aussi utilisé localement (dev, app publiée
 * avant configuration).
 */
export function useFamily () {
  const { config, notifyConfigChange, application } = useConfig()

  const metadataDataset = computed(() => (config.value as any)?.datasets?.[0])

  // valeur effective = entrées du tableau datasets classifiées, sinon détection locale
  // (immédiate après détection, avant l'écho set-config du mode draft)
  const localLinked = ref<Partial<Record<ResourceKind, LinkedRef>>>({})
  const localRealtimeUrl = ref<string | null>(null)

  const linkedDataset = (kind: ResourceKind) => computed(() =>
    familyFromConfig((config.value as any)?.datasets)[kind] ?? localLinked.value[kind] ?? null)
  const shapesDataset = linkedDataset('shapes')
  const stopsDataset = linkedDataset('stops')
  const stopTimesDataset = linkedDataset('stop-times')
  const realtimeUrl = computed(() => (config.value as any)?.realtime?.url ?? localRealtimeUrl.value)

  // état de la détection, pour l'erreur affichée quand la famille est introuvable
  const resolved = ref(false)
  const error = ref<string | null>(null)

  // dernière URL de flux pré-remplie par l'application : permet de distinguer une URL
  // pré-remplie (remplaçable lors d'un changement de jeu) d'une URL saisie manuellement
  // (intouchable)
  let lastAutoUrl: string | null = null

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
            title: doc.title ?? rel.id,
            schema: doc.schema
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

      // La famille complète est référencée dans configuration.datasets : le jeu de
      // métadonnées (entrées réduites aux propriétés déclarées par le schéma, les
      // propriétés injectées au runtime déclencheraient la validation
      // additionalProperties:false du formulaire) puis les jeux liés, qui portent
      // leur schéma pour rester classifiables par familyFromConfig.
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

      // flux temps réel : pièce jointe distante du jeu porteur, pré-remplie dans la
      // configuration sauf si l'utilisateur a saisi manuellement une autre URL
      const detected = carrierDoc ? findRealtimeUrl(carrierDoc) : null
      localRealtimeUrl.value = detected
      if (detected) {
        const currentUrl = (config.value as any)?.realtime?.url
        if ((!currentUrl || currentUrl === lastAutoUrl) && currentUrl !== detected) {
          notifyConfigChange('realtime.url', detected)
        }
        lastAutoUrl = detected
      } else {
        lastAutoUrl = null
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
