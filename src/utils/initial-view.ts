import type { FitBoundsOptions, Map } from 'maplibre-gl'

// west, south, east, north
export type Bounds = [number, number, number, number]
export type InitialView =
  | { center: [number, number], zoom: number }
  | { bounds: Bounds, center?: [number, number], zoom?: number }

type Params = Record<string, string | undefined | null>

// metropolitan France, when there is no extent at all
export const franceBounds: Bounds = [-5.2, 41.3, 9.6, 51.1]

// keys of a shared view replaced by lng / lat / zoom, cleared on write
const deprecatedKeys = ['lon', '_c_map_center', '_c_map_zoom']

const num = (value: unknown) => value != null && value !== '' && Number.isFinite(Number(value)) ? Number(value) : undefined

const validBounds = (bounds?: readonly number[] | null): Bounds | undefined =>
  bounds?.length === 4 && bounds.every(v => Number.isFinite(v)) && bounds[1] <= bounds[3]
    ? [bounds[0], bounds[1], bounds[2], bounds[3]]
    : undefined

// the view of a shared link: lng, lat and zoom, all three or nothing
export function readViewParams (params: Params): { center: [number, number], zoom: number } | undefined {
  // deprecated: `lon` (choropleth, multilayer) and `_c_map_center` / `_c_map_zoom` (explore), still
  // read so that links shared before the unification keep their view
  const [legacyLng, legacyLat] = (params._c_map_center ?? '').split(',')
  const lng = num(params.lng) ?? num(params.lon) ?? num(legacyLng)
  const lat = num(params.lat) ?? num(legacyLat)
  const zoom = num(params.zoom) ?? num(params._c_map_zoom)
  return lng !== undefined && lat !== undefined && zoom !== undefined ? { center: [lng, lat], zoom } : undefined
}

export function writeViewParams (params: Params, center: { lng: number, lat: number }, zoom: number) {
  params.lng = center.lng.toFixed(5)
  params.lat = center.lat.toFixed(5)
  params.zoom = zoom.toFixed(2)
  for (const key of deprecatedKeys) {
    if (key in params) delete params[key]
  }
}

// 1. a shared link, 2. the extent of the data filtered by the parent page (an embed showing one item is
// another kind of shared link), 3. the configured centre and zoom, 4. an extent: configured bounds, else
// the data, else metropolitan France; a configured centre without zoom (or zoom without centre) completes it
export function resolveInitialView (options: {
  params?: Params
  filteredBounds?: readonly number[] | null
  center?: [number, number]
  zoom?: number
  bounds?: readonly number[] | null
  dataBounds?: readonly number[] | null
}): InitialView {
  const shared = options.params && readViewParams(options.params)
  if (shared) return shared
  const filtered = validBounds(options.filteredBounds)
  if (filtered) return { bounds: filtered }
  const center = options.center && num(options.center[0]) !== undefined && num(options.center[1]) !== undefined
    ? options.center
    : undefined
  const zoom = num(options.zoom)
  if (center && zoom !== undefined) return { center, zoom }
  const bounds = validBounds(options.bounds) ?? validBounds(options.dataBounds) ?? franceBounds
  return { bounds, ...(center ? { center } : {}), ...(zoom !== undefined ? { zoom } : {}) }
}

// at creation or once the extent is known: fit the extent, then the configured part on top of it
export function applyInitialView (map: Map, view: InitialView, fit?: FitBoundsOptions) {
  if (!('bounds' in view)) {
    map.jumpTo({ center: view.center, zoom: view.zoom })
    return
  }
  map.fitBounds(view.bounds, { ...fit, animate: false })
  if (view.center) map.jumpTo({ center: view.center })
  if (view.zoom !== undefined) map.jumpTo({ zoom: view.zoom })
}
