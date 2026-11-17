/// <reference types="vite/client" />

import type { Application } from '@data-fair/lib-common-types/application/index.js'
import type { FullSiteInfo } from '@data-fair/lib-vue/session.js'
import type { Map as MLMap } from 'maplibre-gl'
import type { Config } from './config/index.js'

export type AppConfig = Config

declare global {
  interface Window {
    APPLICATION: Application & { apiUrl: string, exposedUrl?: string }
    __PUBLIC_SITE_INFO?: FullSiteInfo
    vIframeOptions?: { reactiveParams: Record<string, string> }
    triggerCapture?: (animationSupported?: boolean) => Promise<boolean>
    /** test hook: maplibre instance, set in DEV only (gtfs-map.vue) */
    __MAP__?: MLMap
  }
}
