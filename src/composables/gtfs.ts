import type { FeatureCollection } from 'geojson'
import type { TransitMode } from '../utils/transit-mode.js'
import { transitMode } from '../utils/transit-mode.js'

/**
 * GTFS domain types and helpers, as produced by processing-gtfs:
 * - 1 "metadata" dataset without data, carrying the attachments (archive + remote GTFS-RT feed)
 * - 3 related datasets declared in relatedDatasets: shapes, stops, departures
 * - or, when the processing groups them, the same 3 datasets as data-fair fragments of the
 *   metadata dataset (partOf), with or without relatedDatasets links
 */

export interface LinkedRef {
  id: string
  href: string
  title: string
  /** related dataset schema, carried by the entries pushed into configuration.datasets to stay classifiable in draft mode */
  schema?: Array<{ key?: string }>
  finalizedAt?: string
}

export type ResourceKind = 'shapes' | 'stops' | 'stop-times'

export interface MetadataDoc {
  id: string
  title?: string
  href?: string
  relatedDatasets?: Array<{ id: string, title?: string }>
  partOf?: { type: string, id: string }
  attachments?: Array<{ type: string, name: string, title?: string, url?: string }>
}

const KIND_FIELDS: [ResourceKind, string[]][] = [
  ['shapes', ['shape_id', 'route_short_name']],
  ['stop-times', ['arrival_time', 'stop_sequence', 'trip_id']],
  ['stops', ['stop_name']]
]

/**
 * Detects a dataset role from its schema (titles may be renamed by the operator,
 * the schema produced by the processing is stable).
 */
export function classifyDataset (doc: { schema?: Array<{ key?: string }>, title?: string }): ResourceKind | null {
  const keys = new Set((doc.schema ?? []).map(p => p.key).filter(Boolean))
  for (const [kind, fields] of KIND_FIELDS) {
    if (fields.some(f => keys.has(f))) return kind
  }
  // fallback: title suffix set by the processing ("Réseau - tracés", etc.)
  const title = (doc.title ?? '').toLowerCase()
  if (title.endsWith('- tracés')) return 'shapes'
  if (title.endsWith('- arrêts')) return 'stops'
  if (title.endsWith('- horaires')) return 'stop-times'
  return null
}

/**
 * Classifies the related datasets referenced in configuration.datasets (entries at index ≥ 1;
 * entry 0 is the selected metadata dataset). These entries are only written
 * via postMessage (use-family), never edited in the form.
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
 * URL of a dataset document.
 *
 * `apiUrl` (injected by the data-fair proxy and the dev-server) is the only reliable
 * base: the app is served under `/app/{id}`, where a relative `api/v1/...` URL
 * would resolve to `/app/api/v1/...`.
 */
export function datasetDocUrl (apiUrl: string, id: string): string {
  return `${apiUrl.replace(/\/$/, '')}/datasets/${encodeURIComponent(id)}`
}

/** True if the attachment is the GTFS-RT feed declared by the processing. */
export const isRealtimeAttachment = (attachment: { type?: string, name?: string }): boolean =>
  attachment.type === 'remoteFile' && /^gtfs-rt/i.test(attachment.name ?? '')

/** True if `doc` references the `selectedId` dataset (bidirectional links set by the processing). */
export const linksBackTo = (doc: { relatedDatasets?: Array<{ id: string }> }, selectedId: string | undefined): boolean =>
  !!selectedId && (doc.relatedDatasets ?? []).some(r => r.id === selectedId)

/** True if `doc` is a data-fair fragment of the dataset `selectedId` (datasets grouped by the processing). */
export const isFragmentOf = (doc: { partOf?: { type?: string, id?: string } }, selectedId: string | undefined): boolean =>
  !!selectedId && doc.partOf?.type === 'dataset' && doc.partOf.id === selectedId

/** True if the document carries the GTFS-RT feed declared by the processing. */
export const hasRealtimeAttachment = (doc: MetadataDoc): boolean =>
  (doc.attachments ?? []).some(isRealtimeAttachment)

/**
 * URL of the GTFS-RT feed remote attachment, through the data-fair proxy
 * (the real feed URL is never exposed to the browser, no CORS constraint).
 * The public link computed by data-fair (`attachment.url`) takes precedence: only it
 * accounts for the instance public domain. Rebuilt as a fallback for responses
 * that lack it (mocks, older instances).
 * Only attachments prefixed with `gtfs-rt` are kept: another manually added remote
 * file must not be decoded as protobuf.
 */
export function findRealtimeUrl (doc: MetadataDoc): string | null {
  const rt = (doc.attachments ?? []).find(isRealtimeAttachment)
  if (!rt) return null
  if (rt.url) return rt.url
  if (!doc.href && !doc.id) return null
  const base = doc.href ?? `api/v1/datasets/${doc.id}`
  return `${base}/metadata-attachments/${encodeURIComponent(rt.name)}`
}

/** Extracts a CSS color from a GTFS route_color value ("00AAFF" or "#00AAFF"). */
export function normalizeColor (raw?: string | null): string | null {
  const v = (raw ?? '').trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(v)) return null
  return v.startsWith('#') ? v : `#${v}`
}

/** Readable (WCAG) text color on a given hex background. */
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
  // 0.179 = threshold luminance for a 4.5:1 contrast with black or white
  return luminance > 0.179 ? '#111111' : '#ffffff'
}

/* ------------------------------------------------------------------ */
/* Geographic layers loading                                          */
/* ------------------------------------------------------------------ */

const API_SIZE = 10000

export interface GeoJsonLayer {
  collection: FeatureCollection
  /** server-side line total, when the API returns it */
  total: number | null
  /** the API returned fewer items than the total (pagination cap reached) */
  truncated: boolean
}

export const isTruncated = (total: number | null | undefined, count: number): boolean =>
  typeof total === 'number' && total > count

// finalizedAt only when known: an empty value would be cached forever by the service worker
export function finalizedAtQuery (finalizedAt?: string): Record<string, string> {
  return finalizedAt ? { finalizedAt } : {}
}

export const geoJsonQuery = (finalizedAt?: string): Record<string, string | number> =>
  ({ format: 'geojson', size: API_SIZE, ...finalizedAtQuery(finalizedAt) })

export function toGeoJsonLayer (raw: FeatureCollection & { total?: number }): GeoJsonLayer {
  const collection: FeatureCollection = { ...raw, features: (raw.features ?? []).filter(f => f.geometry) }
  const total = typeof raw.total === 'number' ? raw.total : null
  return { collection, total, truncated: isTruncated(total, collection.features.length) }
}

/** Normalizes shape colors from route_color, with fallback. */
export function applyFallbackColor (fc: FeatureCollection, fallback: string): FeatureCollection {
  for (const feature of fc.features) {
    const props = feature.properties as Record<string, unknown>
    props.color = normalizeColor(props.route_color as string) ?? fallback
    // an integer route_id column (M réso) must match the string ids of the URL, the legend and GTFS-RT
    if (typeof props.route_id === 'number') props.route_id = String(props.route_id)
  }
  return fc
}

/**
 * Normalizes the routes served by a stop. The GTFS schema `routes` field is
 * multivalued (`separator: ';'`): the GeoJSON API returns an array (arrays are
 * preserved), while the JSON API joins the values into a "1;2" string.
 */
export function normalizeStopRoutes (raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(';') : []
  return values
    .filter((route): route is string => typeof route === 'string')
    .map(route => route.trim())
    .filter(Boolean)
}

/**
 * Removes parent stations (`location_type = 1`) from the stops dataset: each hub
 * then carries a single pair of platforms (one per direction) instead of three points.
 * Features without `location_type` are kept (feeds without hierarchy have none).
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
/* Route filter (configuration)                                       */
/* ------------------------------------------------------------------ */

export type RouteFilterMode = 'all' | 'include' | 'exclude'

/**
 * Ids of the routes kept by the configuration filter.
 *
 * - `null` when no filter applies ("all" mode or empty list);
 * - in "include" mode, the selected list;
 * - in "exclude" mode, every route of the shapes minus the selected list
 *   (routes without a shape cannot be listed, so they stay hidden).
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

/** Removes from a collection the features whose `field` property is not an allowed route. */
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

/** Removes the stops none of whose served routes is allowed. */
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
  /** from GTFS route_type, null when unknown */
  mode?: TransitMode | null
}

/**
 * Route colors indexed by short name: stops and departures carry the short
 * name, not `route_id`. On duplicates (two route_id with the same short name),
 * the first color found is kept.
 */
export function colorsByShortName (routeIndex: Map<string, RouteInfo>): Map<string, string> {
  const colors = new Map<string, string>()
  for (const route of routeIndex.values()) {
    if (route.shortName && !colors.has(route.shortName)) colors.set(route.shortName, route.color)
  }
  return colors
}

/** route_id → route info index, built from the shape properties. */
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
      color: normalizeColor(props.route_color) ?? fallback,
      mode: transitMode(props.route_type)
    })
  }
  return index
}

/* ------------------------------------------------------------------ */
/* Next departures (departures dataset)                               */
/* ------------------------------------------------------------------ */

export interface Departure {
  routeName: string
  color: string | null
  destination: string
  time: string
  seconds: number
}

const DAY_NAMES = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']

/** "HH:MM:SS" (the hour may exceed 24 for a service running past midnight) → seconds. */
export function parseGtfsTime (value?: string | null): number | null {
  const m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec((value ?? '').trim())
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/**
 * Filters and formats today's next departures at a stop (pure function):
 * service validity (weekday, period), upcoming times, sorting, deduplication.
 * `allowedRouteNames` restricts to the routes allowed by the configuration (the
 * departures dataset `route_name` column carries the short name, falling back to the long name).
 */
export function selectDepartures (rows: any[], now: Date, allowedRouteNames?: Set<string> | null): Departure[] {
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
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
    // time past midnight ("25:10:00" = 1:10 the next day): fall back to the current day clock
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
 * Search query for a stop's departures.
 *
 * The `_eq` suffix is mandatory: the data-fair search API only recognizes the
 * `_eq`, `_in`, `_gte`, ... suffixes; a bare key is silently ignored and the
 * request runs without the stop filter.
 */
export function departuresQuery (stopId: string, now: Date = new Date(), finalizedAt?: string): Record<string, string | number> {
  const minTime = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:00`
  return { stop_id_eq: stopId, arrival_time_gte: minTime, sort: 'arrival_time', size: 200, ...finalizedAtQuery(finalizedAt) }
}
