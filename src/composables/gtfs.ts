import dayjs from 'dayjs'
import type { FeatureCollection } from 'geojson'
import { fetchJson } from './http.js'

/**
 * Types et helpers du domaine GTFS produit par processing-gtfs :
 * - 1 jeu « métadonnées » sans données, porteur des pièces jointes (archive + flux GTFS-RT distant)
 * - 3 jeux liés déclarés dans relatedDatasets : tracés, arrêts, horaires
 */

export interface LinkedRef {
  id: string
  href: string
  title: string
  /** schéma du jeu lié, porté par les entrées poussées dans configuration.datasets pour rester classifiables en mode draft */
  schema?: Array<{ key?: string }>
}

export type ResourceKind = 'shapes' | 'stops' | 'stop-times'

export interface MetadataDoc {
  id: string
  title?: string
  href?: string
  relatedDatasets?: Array<{ id: string, title?: string }>
  attachments?: Array<{ type: string, name: string, title?: string, url?: string }>
}

const KIND_FIELDS: [ResourceKind, string[]][] = [
  ['shapes', ['shape_id', 'route_short_name']],
  ['stop-times', ['arrival_time', 'stop_sequence', 'trip_id']],
  ['stops', ['stop_name']]
]

/**
 * Détecte le rôle d'un jeu de données d'après son schéma (les titres peuvent être renommés
 * par l'exploitant, le schéma produit par le traitement est stable).
 */
export function classifyDataset (doc: { schema?: Array<{ key?: string }>, title?: string }): ResourceKind | null {
  const keys = new Set((doc.schema ?? []).map(p => p.key).filter(Boolean))
  for (const [kind, fields] of KIND_FIELDS) {
    if (fields.some(f => keys.has(f))) return kind
  }
  // repli : suffixe de titre posé par le traitement (« Réseau - tracés », etc.)
  const title = (doc.title ?? '').toLowerCase()
  if (title.endsWith('- tracés')) return 'shapes'
  if (title.endsWith('- arrêts')) return 'stops'
  if (title.endsWith('- horaires')) return 'stop-times'
  return null
}

/**
 * Classifie les jeux liés référencés dans configuration.datasets (entrées d'index ≥ 1 ;
 * l'entrée 0 est le jeu de métadonnées sélectionné). Ces entrées sont écrites uniquement
 * par postMessage (use-family), jamais éditées dans le formulaire.
 */
export function familyFromConfig (
  datasets: Array<LinkedRef | undefined> | undefined
): Partial<Record<ResourceKind, LinkedRef>> {
  const family: Partial<Record<ResourceKind, LinkedRef>> = {}
  for (const entry of (datasets ?? []).slice(1)) {
    if (!entry?.id && !entry?.href) continue
    const kind = classifyDataset(entry)
    if (kind && !family[kind]) family[kind] = entry
  }
  return family
}

/**
 * URL d'un document de jeu de données.
 *
 * `apiUrl` (injecté par le proxy data-fair et par le dev-server) est la seule base
 * fiable : l'application est servie sous `/app/{id}`, où une URL relative `api/v1/...`
 * partirait sur `/app/api/v1/...`.
 */
export function datasetDocUrl (apiUrl: string, id: string): string {
  return `${apiUrl.replace(/\/$/, '')}/datasets/${encodeURIComponent(id)}`
}

/** Vrai si la pièce jointe est le flux GTFS-RT déclaré par le traitement. */
export const isRealtimeAttachment = (attachment: { type?: string, name?: string }): boolean =>
  attachment.type === 'remoteFile' && /^gtfs-rt/i.test(attachment.name ?? '')

/** Vrai si `doc` référence le jeu `selectedId` (liens bidirectionnels posés par le traitement). */
export const linksBackTo = (doc: { relatedDatasets?: Array<{ id: string }> }, selectedId: string | undefined): boolean =>
  !!selectedId && (doc.relatedDatasets ?? []).some(r => r.id === selectedId)

/** Vrai si le document porte le flux GTFS-RT déclaré par le traitement. */
export const hasRealtimeAttachment = (doc: MetadataDoc): boolean =>
  (doc.attachments ?? []).some(isRealtimeAttachment)

/**
 * URL de la pièce jointe distante du flux GTFS-RT, à travers le proxy data-fair
 * (l'URL réelle du flux n'est jamais exposée au navigateur, pas de contrainte CORS).
 * Le lien public calculé par data-fair (`attachment.url`) est prioritaire : lui seul
 * tient compte du domaine public de l'instance. Reconstruction en repli pour les
 * réponses qui ne le portent pas (mocks, instances anciennes).
 * Seules les pièces jointes préfixées `gtfs-rt` sont retenues : un autre fichier distant
 * ajouté à la main ne doit pas être décodé comme du protobuf.
 */
export function findRealtimeUrl (doc: MetadataDoc): string | null {
  const rt = (doc.attachments ?? []).find(isRealtimeAttachment)
  if (!rt) return null
  if (rt.url) return rt.url
  if (!doc.href && !doc.id) return null
  const base = doc.href ?? `api/v1/datasets/${doc.id}`
  return `${base}/metadata-attachments/${encodeURIComponent(rt.name)}`
}

/** Extrait une couleur CSS d'une valeur GTFS route_color (« 00AAFF » ou « #00AAFF »). */
export function normalizeColor (raw?: string | null): string | null {
  const v = (raw ?? '').trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(v)) return null
  return v.startsWith('#') ? v : `#${v}`
}

/** Couleur de texte lisible (WCAG) sur un fond hexadécimal donné. */
export function contrastTextColor (raw?: string | null): string {
  const hex = normalizeColor(raw)
  if (!hex) return '#ffffff'
  const channel = (value: number) => {
    const s = value / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const luminance = 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b)
  // 0.179 = luminance limite pour un contraste 4.5:1 avec noir ou blanc
  return luminance > 0.179 ? '#111111' : '#ffffff'
}

/* ------------------------------------------------------------------ */
/* Chargement des couches géographiques                                */
/* ------------------------------------------------------------------ */

const API_SIZE = 10000

export interface GeoJsonLayer {
  collection: FeatureCollection
  /** total de lignes côté serveur, quand l'API le renvoie */
  total: number | null
  /** l'API a renvoyé moins d'objets que le total (plafond de pagination atteint) */
  truncated: boolean
}

export const isTruncated = (total: number | null | undefined, count: number): boolean =>
  typeof total === 'number' && total > count

/** Point d'insertion des couches GTFS dans le style du fond de carte :
 * au-dessus de la dernière couche « line » (routes, ponts...), sous les labels (« symbol ») suivants. */
export function gtfsInsertBeforeId (layers: ReadonlyArray<{ id: string, type: string }>): string | undefined {
  let lastLine = -1
  layers.forEach((l, i) => { if (l.type === 'line') lastLine = i })
  return layers.slice(lastLine + 1).find(l => l.type === 'symbol')?.id
}

export async function loadGeoJson (href: string): Promise<GeoJsonLayer> {
  const result = await fetchJson<FeatureCollection & { total?: number }>(`${href}/lines?format=geojson&size=${API_SIZE}`)
  result.features = (result.features ?? []).filter(f => f.geometry)
  const total = typeof result.total === 'number' ? result.total : null
  return { collection: result, total, truncated: isTruncated(total, result.features.length) }
}

/** Normalise la couleur des tracés d'après route_color, avec repli. */
export function applyFallbackColor (fc: FeatureCollection, fallback: string): FeatureCollection {
  for (const feature of fc.features) {
    const props = feature.properties as Record<string, unknown>
    props.color = normalizeColor(props.route_color as string) ?? fallback
  }
  return fc
}

/**
 * Normalise les lignes desservies d'un arrêt. Le champ `routes` du schéma GTFS est
 * multivalué (`separator: ';'`) : l'API GeoJSON renvoie donc un tableau (les tableaux
 * sont préservés), tandis que l'API JSON joint les valeurs en une chaîne « 1;2 ».
 */
export function normalizeStopRoutes (raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(';') : []
  return values
    .filter((route): route is string => typeof route === 'string')
    .map(route => route.trim())
    .filter(Boolean)
}

/**
 * Retire les stations parentes (`location_type = 1`) du jeu « arrêts » : chaque pôle
 * porte alors une seule paire de plateformes (une par sens) au lieu de trois points.
 * Les features sans `location_type` sont conservées (les flux sans hiérarchie n'en ont pas).
 */
export function filterPlatformStops (fc: FeatureCollection | null): FeatureCollection | null {
  if (!fc) return fc
  return {
    ...fc,
    features: fc.features.filter(f =>
      (f.properties as Record<string, unknown> | null)?.location_type !== '1' &&
      (f.properties as Record<string, unknown> | null)?.location_type !== 1)
  }
}

/* ------------------------------------------------------------------ */
/* Filtre de lignes (configuration)                                    */
/* ------------------------------------------------------------------ */

export type RouteFilterMode = 'all' | 'include' | 'exclude'

/**
 * Identifiants des lignes conservées par le filtre de configuration.
 *
 * - `null` quand aucun filtre ne s'applique (mode « toutes » ou liste vide) ;
 * - en mode « include », la liste sélectionnée ;
 * - en mode « exclude », toutes les lignes des tracés moins la liste sélectionnée
 *   (les lignes sans tracé ne peuvent pas être listées, elles restent donc masquées).
 */
export function resolveAllowedRouteIds (
  mode: string | undefined,
  configured: string[] | undefined,
  allRouteIds: Iterable<string>
): Set<string> | null {
  const ids = (configured ?? []).map(String).filter(Boolean)
  if ((mode !== 'include' && mode !== 'exclude') || !ids.length) return null
  const selected = new Set(ids)
  if (mode === 'include') return selected
  const allowed = new Set<string>()
  for (const id of allRouteIds) {
    const value = String(id)
    if (value && !selected.has(value)) allowed.add(value)
  }
  return allowed
}

/** Retire d'une collection les features dont la propriété `field` n'est pas une ligne autorisée. */
export function filterFeaturesByRoutes (
  fc: FeatureCollection | null,
  field: string,
  allowed: Set<string> | null
): FeatureCollection | null {
  if (!fc || !allowed) return fc
  return {
    ...fc,
    features: fc.features.filter(f => {
      const value = (f.properties as Record<string, unknown> | null)?.[field]
      return value != null && value !== '' && allowed.has(String(value))
    })
  }
}

/** Retire les arrêts dont aucune ligne desservie n'est autorisée. */
export function filterStopsByRouteNames (
  fc: FeatureCollection | null,
  allowedNames: Set<string> | null
): FeatureCollection | null {
  if (!fc || !allowedNames) return fc
  return {
    ...fc,
    features: fc.features.filter(f =>
      normalizeStopRoutes((f.properties as Record<string, unknown> | null)?.routes)
        .some(name => allowedNames.has(name)))
  }
}

export interface RouteInfo {
  routeId: string
  shortName: string
  longName: string
  color: string
}

/** Index route_id → infos de ligne, construit depuis les propriétés des tracés. */
export function buildRouteIndex (shapes: FeatureCollection | null, fallback: string): Map<string, RouteInfo> {
  const index = new Map<string, RouteInfo>()
  for (const feature of shapes?.features ?? []) {
    const props = feature.properties as Record<string, string>
    const routeId = props.route_id ?? ''
    if (!routeId || index.has(routeId)) continue
    index.set(routeId, {
      routeId,
      shortName: props.route_short_name || props.route_long_name || routeId,
      longName: props.route_long_name || '',
      color: normalizeColor(props.route_color) ?? fallback
    })
  }
  return index
}

/* ------------------------------------------------------------------ */
/* Prochains passages (jeu « horaires »)                               */
/* ------------------------------------------------------------------ */

export interface Departure {
  routeName: string
  color: string | null
  destination: string
  time: string
  seconds: number
}

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

/** « HH:MM:SS » (l'heure peut dépasser 24 pour un service passant minuit) → secondes. */
export function parseGtfsTime (value?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec((value ?? '').trim())
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * Filtre et met en forme les prochains passages d'un arrêt aujourd'hui (fonction pure) :
 * validité du service (jour de la semaine, période), heures à venir, tri, dédoublonnage.
 * `allowedRouteNames` restreint aux lignes autorisées par la configuration (la colonne
 * `route_name` du jeu « horaires » porte le nom court, avec repli sur le nom long).
 */
export function selectDepartures (rows: any[], now: Date, allowedRouteNames?: Set<string> | null): Departure[] {
  const today = dayjs(now).format('YYYY-MM-DD')
  const dayName = DAY_NAMES[(now.getDay() + 6) % 7]
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

  const departures: Departure[] = []
  for (const row of rows) {
    if (allowedRouteNames && !allowedRouteNames.has(row.route_name ?? '')) continue
    if (row.start_date && row.start_date > today) continue
    if (row.end_date && row.end_date < today) continue
    if (row.week && !String(row.week).split(';').includes(dayName)) continue
    const seconds = parseGtfsTime(row.departure_time) ?? parseGtfsTime(row.arrival_time)
    if (seconds == null) continue
    // heure passant minuit (« 25:10:00 » = 1 h 10 le lendemain) : repli sur l'horloge du jour
    const clockSeconds = seconds >= 86400 ? seconds - 86400 : seconds
    if (clockSeconds < nowSeconds - 30) continue
    departures.push({
      routeName: row.route_name ?? '',
      color: normalizeColor(row.route_color),
      destination: row.stop_destination ?? '',
      time: `${String(Math.floor(clockSeconds / 3600)).padStart(2, '0')}:${String(Math.floor((clockSeconds % 3600) / 60)).padStart(2, '0')}`,
      seconds: clockSeconds
    })
  }
  departures.sort((a, b) => a.seconds - b.seconds)
  const seen = new Set<string>()
  const unique = departures.filter(d => {
    const key = `${d.routeName}|${d.destination}|${d.time}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return unique.slice(0, 6)
}

/**
 * URL de recherche des passages d'un arrêt.
 *
 * Le suffixe `_eq` est obligatoire : l'API search de data-fair ne reconnaît que les
 * suffixes `_eq`, `_in`, `_gte`, ... — une clé nue est silencieusement ignorée et la
 * requête repart sans filtre d'arrêt.
 */
export function buildDeparturesUrl (stopTimesHref: string, stopId: string, now: Date = new Date()): string {
  const minTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
  return `${stopTimesHref}/lines?stop_id_eq=${encodeURIComponent(stopId)}&arrival_time_gte=${encodeURIComponent(minTime)}&sort=arrival_time&size=200`
}

/**
 * Prochains passages d'un arrêt aujourd'hui.
 * Le filtre serveur (égalité stop_id, heures >= maintenant en comparaison lexicographique,
 * valide pour des heures « HH:MM:SS ») est complété côté client par la validité du service.
 */
export async function loadDepartures (
  stopTimesHref: string,
  stopId: string,
  now: Date = new Date(),
  allowedRouteNames?: Set<string> | null
): Promise<Departure[]> {
  const result = await fetchJson<{ results?: any[] }>(buildDeparturesUrl(stopTimesHref, stopId, now))
  return selectDepartures(result.results ?? [], now, allowedRouteNames)
}
