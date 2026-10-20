import type { App, ComputedRef, Ref } from 'vue'
import type { Application, Dataset } from '@data-fair/lib-common-types/application/index.js'
import type { Config } from '@/config/index.js'
import { computed, inject, ref } from 'vue'

export interface ConfigState {
  application: Application & { href: string, apiUrl: string, exposedUrl?: string }
  config: Ref<Config>
  setConfig: (newConfig: Config) => void
  notifyConfigChange: (field: string, value: unknown) => void
  dataset: ComputedRef<Dataset | undefined>
  error: ComputedRef<string | null>
}

/** True when data-fair serves the app in configuration draft mode. */
export function isDraftMode (search = window.location.search): boolean {
  return new URLSearchParams(search).get('draft') === 'true'
}

export function createConfig () {
  const application = window.APPLICATION as Application & { href: string, apiUrl: string }
  const config = ref<Config>((application?.configuration || {}) as Config)

  // GTFS metadata dataset selected in the configuration form
  const dataset = computed(() => config.value?.datasets?.[0] as unknown as Dataset | undefined)

  const error = computed(() => {
    // message keys, translated by the component that shows them
    if (!config.value) return 'noConfig'
    if (!dataset.value) return 'noDataset'
    return null
  })

  function setConfig (newConfig: any) {
    config.value = newConfig
  }

  function notifyConfigChange (field: string, value: unknown) {
    if (window.parent !== window) {
      window.parent.postMessage({
        type: 'set-config',
        // values come from Vue reactive state: a Proxy (e.g. a dataset schema read
        // from config.value) fails postMessage structured clone (DataCloneError)
        // and silently broke the whole sync
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
          // Formats actually emitted by the DataFair UI (application-config.vue):
          // - UI → app: full config directly in content
          // - app → UI: { field, value } (update by path)
          if (content.configuration) {
            config.value = content.configuration
          } else if (content.datasets || content.realtime || content.map || content.routes) {
            // Merge rather than overwrite: some emitters only send
            // the modified subtree (sibling fields would be lost).
            config.value = { ...config.value, ...content }
          } else if (content.field && 'value' in content) {
            // Update by path (e.g. 'realtime.url')
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
