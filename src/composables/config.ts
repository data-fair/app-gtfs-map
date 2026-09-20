import { computed, inject, ref, type App, type ComputedRef, type Ref } from 'vue'
import type { Application, Dataset } from '@data-fair/lib-common-types/application/index.js'
import type { Config } from '@/config/index.js'

export interface ConfigState {
  application: Application & { href: string, apiUrl: string, exposedUrl?: string }
  config: Ref<Config>
  setConfig: (newConfig: Config) => void
  notifyConfigChange: (field: string, value: unknown) => void
  dataset: ComputedRef<Dataset | undefined>
  error: ComputedRef<string | null>
}

/** Vrai quand l'application est servie par data-fair en mode brouillon de configuration. */
export function isDraftMode (search = window.location.search): boolean {
  return new URLSearchParams(search).get('draft') === 'true'
}

export function createConfig () {
  const application = window.APPLICATION as Application & { href: string, apiUrl: string }
  const config = ref<any>(application?.configuration || {})

  // Jeu de métadonnées GTFS sélectionné dans le formulaire de configuration
  const dataset = computed(() => (config.value as Config)?.datasets?.[0] as unknown as Dataset | undefined)

  const error = computed(() => {
    if (!config.value) return 'Il n\'y a pas de configuration définie'
    if (!dataset.value) return 'Veuillez sélectionner un jeu de données GTFS'
    return null
  })

  function setConfig (newConfig: any) {
    config.value = newConfig
  }

  function notifyConfigChange (field: string, value: unknown) {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'set-config',
        // les valeurs viennent de l'état réactif Vue : un Proxy (ex. le schéma d'un jeu
        // lu dans config.value) ne passe pas le structured clone de postMessage
        // (DataCloneError) et faisait échouer silencieusement toute la synchronisation
        content: { field, value: value === undefined ? undefined : JSON.parse(JSON.stringify(value)) }
      }, window.location.origin)
    }
  }

  function setByPath (obj: Record<string, unknown>, path: string, value: unknown) {
    const keys = path.split('.')
    let current: any = obj
    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i]
      if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
        current[key] = {}
      } else {
        current[key] = Array.isArray(current[key]) ? [...current[key]] : { ...current[key] }
      }
      current = current[key]
    }
    current[keys[keys.length - 1]] = value
  }

  return {
    install (app: App) {
      app.provide('data-fair-app-config', {
        application,
        config,
        setConfig,
        notifyConfigChange,
        dataset,
        error
      })

      window.addEventListener('message', (event) => {
        if (event.data?.type === 'set-config' && event.data?.content) {
          const { content } = event.data
          // Formats réellement émis par l'UI DataFair (application-config.vue) :
          // - UI → app : la config complète directement dans content
          // - app → UI : { field, value } (update par path)
          if (content.configuration) {
            config.value = content.configuration
          } else if (content.datasets || content.realtime || content.map || content.routes) {
            // Fusionner plutôt qu'écraser : certains émetteurs n'envoient
            // qu'un sous-arbre modifié (perte des champs frères sinon).
            config.value = { ...config.value, ...content }
          } else if (content.field && 'value' in content) {
            // Update par path (ex: 'realtime.url')
            const newConfig = JSON.parse(JSON.stringify(config.value))
            setByPath(newConfig, content.field, content.value)
            config.value = newConfig
          }
        }
      })
    }
  }
}

export function useConfig (): ConfigState {
  const config = inject<ConfigState>('data-fair-app-config')
  if (!config) throw new Error('useConfig requires using the plugin createConfig')
  return config
}
