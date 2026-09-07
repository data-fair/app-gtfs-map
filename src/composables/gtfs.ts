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
}

export type ResourceKind = 'shapes' | 'stops' | 'stop-times'

export interface MetadataDoc {
  id: string
  title?: string
  href?: string
  relatedDatasets?: Array<{ id: string, title?: string }>
  attachments?: Array<{ type: string, name: string, title?: string }>
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

/** Nom du champ de configuration portant la référence d'un jeu lié. */
export const kindToConfigField = (kind: ResourceKind) =>
  ({ shapes: 'shapesDataset', stops: 'stopsDataset', 'stop-times': 'stopTimesDataset' })[kind]

/**
 * URL de la pièce jointe distante du flux GTFS-RT, à travers le proxy data-fair
 * (l'URL réelle du flux n'est jamais exposée au navigateur, pas de contrainte CORS).
 */
export function findRealtimeUrl (doc: MetadataDoc): string | null {
  const attachments = doc.attachments ?? []
  const remote = attachments.filter(a => a.type === 'remoteFile')
  const rt = remote.find(a => /^gtfs-rt/i.test(a.name)) ?? remote[0]
  if (!rt) return null
  const base = doc.href ?? `api/v1/datasets/${doc.id}`
  return `${base}/metadata-attachments/${rt.name}`
}

/** Extrait une couleur CSS d'une valeur GTFS route_color (« 00AAFF » ou « #00AAFF »). */
export function normalizeColor (raw?: string | null): string | null {
  const v = (raw ?? '').trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(v)) return null
  return v.startsWith('#') ? v : `#${v}`
}

/* ------------------------------------------------------------------ */
/* Chargement des couches géographiques                                */
/* ------------------------------------------------------------------ */

const API_SIZE = 10000

export async function loadGeoJson (href: string): Promise<FeatureCollection> {
  const result = await fetchJson<FeatureCollection>(`${href}/lines?format=geojson&size=${API_SIZE}`)
  result.features = (result.features ?? []).filter(f => f.geometry)
  return result
}

/** Normalise la couleur des tracés d'après route_color, avec repli. */
export function applyFallbackColor (fc: FeatureCollection, fallback: string): FeatureCollection {
  for (const feature of fc.features) {
    const props = feature.properties as Record<string, unknown>
    props.color = normalizeColor(props.route_color as string) ?? fallback
  }
  return fc
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
 */
export function selectDepartures (rows: any[], now: Date): Departure[] {
  const today = dayjs(now).format('YYYY-MM-DD')
  const dayName = DAY_NAMES[(now.getDay() + 6) % 7]
  const nowSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds()

  const departures: Departure[] = []
  for (const row of rows) {
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
 * Prochains passages d'un arrêt aujourd'hui.
 * Le filtre serveur (égalité stop_id, heures >= maintenant en comparaison lexicographique,
 * valide pour des heures « HH:MM:SS ») est complété côté client par la validité du service.
 */
export async function loadDepartures (
  stopTimesHref: string,
  stopId: string,
  now: Date = new Date()
): Promise<Departure[]> {
  const minTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
  const result = await fetchJson<{ results?: any[] }>(
    `${stopTimesHref}/lines?stop_id=${encodeURIComponent(stopId)}&arrival_time_gte=${encodeURIComponent(minTime)}&sort=arrival_time:1&size=200`
  )
  return selectDepartures(result.results ?? [], now)
}
