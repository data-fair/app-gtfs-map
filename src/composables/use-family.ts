import { computed, ref, watch } from 'vue'
import { useConfig } from './config.js'
import { fetchJson } from './http.js'
import { classifyDataset, findRealtimeUrl, kindToConfigField, type LinkedRef, type MetadataDoc, type ResourceKind } from './gtfs.js'

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
  const { config, notifyConfigChange } = useConfig()

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

  let resolving = false

  async function resolve () {
    const dataset = metadataDataset.value
    if (!dataset?.href || resolving) return
    resolving = true
    try {
      const selfDoc: MetadataDoc = await fetchJson(dataset.href)
      const related = selfDoc.relatedDatasets ?? []

      // document de chaque jeu candidat, pour le classer par schéma
      const found = new Map<ResourceKind, LinkedRef>()
      // le jeu sélectionné est-il déjà porteur d'une pièce jointe distante (flux RT) ?
      let carrierDoc: MetadataDoc | null = hasRealtimeAttachment(selfDoc) ? selfDoc : null
      await Promise.all(related.map(async (rel) => {
        try {
          const doc = await fetchJson<any>(`api/v1/datasets/${rel.id}`)
          const kind = classifyDataset(doc)
          if (kind && !found.has(kind)) {
            found.set(kind, { id: doc.id, href: doc.href ?? `api/v1/datasets/${doc.id}`, title: doc.title ?? rel.id })
          } else if (!kind && !carrierDoc && hasRealtimeAttachment(doc)) {
            // jeu de métadonnées parmi les liés (cas d'un jeu de données lié sélectionné à la place)
            carrierDoc = doc
          }
        } catch {
          // un jeu lié indisponible n'empêche pas d'afficher les autres couches
        }
      }))

      localLinked.value = Object.fromEntries(found) as Partial<Record<ResourceKind, LinkedRef>>
      for (const [kind, linkedRef] of found) {
        const field = `gtfsMap.${kindToConfigField(kind)}`
        const current = (config.value as any)?.gtfsMap?.[kindToConfigField(kind)]
        if (current?.id !== linkedRef.id || current?.href !== linkedRef.href) {
          notifyConfigChange(field, linkedRef)
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
      // le jeu est peut-être en cours de finalisation : erreur silencieuse, la résolution
      // repartira au prochain changement de configuration
    } finally {
      resolving = false
    }
  }

  // une clé stable (id + href) évite de repartir sur le simple echo set-config du draft
  watch(() => `${metadataDataset.value?.id}|${metadataDataset.value?.href}`, resolve, { immediate: true })

  return { metadataDataset, shapesDataset, stopsDataset, stopTimesDataset, realtimeUrl, resolved }
}

function hasRealtimeAttachment (doc: MetadataDoc): boolean {
  return (doc.attachments ?? []).some(a => a.type === 'remoteFile')
}
