import type { VehicleProperties } from './use-vehicles.js'

/**
 * Item detailed in the panel "Selection" section: a route, a stop or a vehicle.
 * A route is stored by id only and resolved at render time from the route index
 * (always fresh data); a vehicle carries a snapshot used as fallback when it
 * leaves the realtime feed.
 */
export type Selection =
  | { kind: 'route', routeId: string }
  | { kind: 'stop', stopId: string, stopName: string, routes: string[] }
  | { kind: 'vehicle', vehicleId: string, vehicle: VehicleProperties }
