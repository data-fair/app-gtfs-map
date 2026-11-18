import type { RasterSourceSpecification, StyleSpecification } from 'maplibre-gl'

export interface Basemap {
  id: string
  title: string
  dark?: true
  // hosted outside the site's /tileserver
  external?: true
  // to pass as AttributionControl customAttribution: the styles carry no credit, and the new
  // tileserver's tilejson lost it. OSM is the exact production tilejson string, so maplibre
  // drops it as a duplicate when the tilejson carries it.
  attribution?: string[]
}

const IGN = '© IGN'
const UN = '© United Nations — ClearMap'
const ESRI = '© Esri, HERE, Garmin, © OpenStreetMap contributors'
const OSM = '<a href="https://www.openmaptiles.org/" target="_blank">&copy; OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank">&copy; OpenStreetMap contributors</a>'

// ids are the values stored in application configurations: never rename one
export const basemaps: Basemap[] = [
  { id: 'klokantech-basic', title: 'Klokantech Basic', attribution: [OSM] },
  { id: 'minimal', title: 'Minimal', attribution: [OSM] },
  { id: 'void', title: 'Vide' },
  { id: 'admindiv', title: 'Divisions administratives', attribution: [OSM] },
  { id: 'dark-matter', title: 'Dark Matter', dark: true, attribution: [OSM] },
  { id: 'dark-koumoul', title: 'Koumoul sombre', dark: true, attribution: [OSM] },
  { id: 'fiord-color', title: 'Fiord Color', dark: true, attribution: [OSM] },
  { id: 'osm-bright', title: 'OSM Bright', attribution: [OSM] },
  { id: 'positron', title: 'Positron', attribution: [OSM] },
  { id: 'osm-liberty', title: 'OSM Liberty', attribution: [OSM] },
  { id: 'cassini', title: 'Cassini', attribution: [OSM] },
  { id: 'cadastre', title: 'Cadastre', attribution: [OSM] },
  // aerial imagery is dark: drawings on top use light colours
  { id: 'satellite', title: 'Vue satellite', dark: true, attribution: [IGN, OSM] },
  { id: 'plan-ign-standard', title: 'Plan IGN', external: true, attribution: [IGN] },
  { id: 'plan-ign-ortho', title: 'Photographies aériennes (IGN)', dark: true, external: true, attribution: [IGN] },
  { id: 'unesco-clearmap', title: 'UNESCO ClearMap (monde)', external: true, attribution: [UN] },
  { id: 'esri-light-gray', title: 'Esri Light Gray Canvas', external: true, attribution: [ESRI] }
]

export const ignOrthoSource: RasterSourceSpecification = {
  type: 'raster',
  tiles: ['https://data.geopf.fr/tms/1.0.0/ORTHOIMAGERY.ORTHOPHOTOS/{z}/{x}/{y}.jpeg'],
  tileSize: 256,
  maxzoom: 19,
  attribution: IGN
}

// metadata flag of a raster of labels (Esri reference layer): firstSymbolLayer counts it in the top
// block of labels, so the data goes under it as under symbol labels
const LABELS = 'map-styles:labels'

const arcgisSource = (service: string, maxzoom: number): RasterSourceSpecification => ({
  type: 'raster',
  tiles: [`${service}/MapServer/tile/{z}/{y}/{x}`],
  tileSize: 256,
  maxzoom
})

export function resolveMapStyle (id: string, origin: string): string | StyleSpecification {
  // glyphs let an application add text layers on top of a local style
  const glyphs = `${origin}/tileserver/fonts/{fontstack}/{range}.pbf`
  switch (id) {
    case 'void': return { version: 8, glyphs, sources: {}, layers: [] }
    case 'plan-ign-standard': return 'https://data.geopf.fr/annexes/ressources/vectorTiles/styles/PLAN.IGN/standard.json'
    case 'plan-ign-ortho': return {
      version: 8,
      glyphs,
      sources: { 'ign-ortho': structuredClone(ignOrthoSource) },
      layers: [{ id: 'ign-ortho', type: 'raster', source: 'ign-ortho' }]
    }
    // z7 and beyond are a "map not available" watermark: maplibre overzooms z6
    case 'unesco-clearmap': return {
      version: 8,
      glyphs,
      sources: { 'unesco-clearmap': arcgisSource('https://geoservices.un.org/arcgis/rest/services/ClearMap_WebTopo', 6) },
      layers: [{ id: 'unesco-clearmap', type: 'raster', source: 'unesco-clearmap' }]
    }
    case 'esri-light-gray': return {
      version: 8,
      glyphs,
      sources: {
        'esri-light-gray-base': arcgisSource('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base', 16),
        'esri-light-gray-reference': arcgisSource('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference', 16)
      },
      layers: [
        { id: 'esri-light-gray-base', type: 'raster', source: 'esri-light-gray-base' },
        { id: 'esri-light-gray-reference', type: 'raster', source: 'esri-light-gray-reference', metadata: { [LABELS]: true } }
      ]
    }
    default: return `${origin}/tileserver/styles/${id}/style.json`
  }
}

const isLabel = (layer?: { type: string, metadata?: unknown }) =>
  layer?.type === 'symbol' || (layer?.metadata as Record<string, unknown> | undefined)?.[LABELS] === true

/**
 * Id of the first layer of the top block of labels (symbol layers, or a raster of labels), to
 * insert data above roads and boundaries but below place names. Call it on the basemap layers,
 * before adding data layers. Undefined when the style ends with no label: add on top.
 */
export function firstSymbolLayer (layers: readonly { id: string, type: string, metadata?: unknown }[]): string | undefined {
  let i = layers.length
  while (i > 0 && isLabel(layers[i - 1])) i--
  return layers[i]?.id
}

// transformRequest that sends the session cookie to the site itself only
export function credentialsFor (origin: string) {
  return (url: string): { url: string, credentials?: 'include' } =>
    url.startsWith(origin + '/') ? { url, credentials: 'include' } : { url }
}

const frLocale: Record<string, string> = {
  'AttributionControl.ToggleAttribution': 'Afficher ou masquer les crédits',
  'AttributionControl.MapFeedback': 'Signaler un problème sur la carte',
  'FullscreenControl.Enter': 'Passer en plein écran',
  'FullscreenControl.Exit': 'Quitter le plein écran',
  'GeolocateControl.FindMyLocation': 'Me localiser',
  'GeolocateControl.LocationNotAvailable': 'Position indisponible',
  'Map.Title': 'Carte',
  'Marker.Title': 'Marqueur',
  'NavigationControl.ResetBearing': 'Faire glisser pour pivoter la carte, cliquer pour revenir au nord',
  'NavigationControl.ZoomIn': 'Zoom avant',
  'NavigationControl.ZoomOut': 'Zoom arrière',
  'Popup.Close': 'Fermer la bulle',
  'GlobeControl.Enable': 'Passer en vue globe',
  'GlobeControl.Disable': 'Revenir à la vue à plat',
  'CooperativeGesturesHandler.WindowsHelpText': 'Utilisez Ctrl + molette pour zoomer sur la carte',
  'CooperativeGesturesHandler.MacHelpText': 'Utilisez ⌘ + molette pour zoomer sur la carte',
  'CooperativeGesturesHandler.MobileHelpText': 'Utilisez deux doigts pour déplacer la carte'
}

// maplibre `locale` option from the session language: maplibre's own strings are english
export function mapLocale (lang: string): Record<string, string> {
  return lang.startsWith('fr') ? { ...frLocale } : {}
}

interface StyleSwitchMap {
  setStyle (style: string | StyleSpecification, options?: object): unknown
  on (type: 'style.load' | 'error', listener: (event: { error?: { url?: string }, sourceId?: string }) => void): unknown
}

/**
 * Basemap switch for a map created on `initial`: call it right after `new Map`, before the app's
 * own permanent `style.load` listener, and read `current()` there (attribution, contrast). The last
 * requested basemap wins (no guard while a style loads), and a style that fails (HTTP error, invalid
 * JSON, validation) gives way to the last basemap that loaded. Never `once('style.load')` after
 * `setStyle`: an object style (`void`, `plan-ign-ortho`) loads synchronously inside it.
 */
export function createBasemapSwitch (map: StyleSwitchMap, initial: string, origin: string) {
  let loaded = initial
  let requested = initial
  let url: string | undefined
  let options: object | undefined
  map.on('style.load', () => { loaded = requested })
  map.on('error', (event) => {
    // while a style loads, an error of no source and of no other URL (sprite, stale request) is the style's
    const styleError = requested !== loaded && !event.sourceId && (event.error?.url === undefined || event.error.url === url)
    if (!styleError) {
      // maplibre only logs errors when no `error` listener exists: keep that default
      console.error(event.error)
      return
    }
    url = undefined
    requested = loaded
    // the failed style never loaded: nothing to diff against (maplibre would warn and rebuild)
    map.setStyle(resolveMapStyle(loaded, origin), { ...options, diff: false })
  })
  return {
    set (id: string, setOptions?: object) {
      requested = id
      options = setOptions
      const style = resolveMapStyle(id, origin)
      url = typeof style === 'string' ? style : undefined
      map.setStyle(style, setOptions)
    },
    current: () => requested
  }
}
