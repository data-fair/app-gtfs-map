import { mdiBus, mdiBusElectric, mdiFerry, mdiGondola, mdiSubwayVariant, mdiTrain, mdiTrainCarPassenger, mdiTrainVariant, mdiTram } from '@mdi/js'

export type TransitMode = 'metro' | 'tram' | 'train' | 'bus' | 'trolleybus' | 'ferry' | 'monorail' | 'funicular' | 'aerialLift'

// GTFS route_type order: 0 tram, 1 metro, 2 rail, 3 bus, 4 ferry, 6 aerial lift, 7 funicular, 11 trolleybus, 12 monorail
export const MODE_ORDER: readonly TransitMode[] = ['tram', 'metro', 'train', 'bus', 'ferry', 'aerialLift', 'funicular', 'trolleybus', 'monorail']

// no dedicated icon for funicular and monorail in @mdi/js 7.4: closest rail vehicles
export const MODE_ICONS: Record<TransitMode, string> = {
  metro: mdiSubwayVariant,
  tram: mdiTram,
  train: mdiTrain,
  bus: mdiBus,
  trolleybus: mdiBusElectric,
  ferry: mdiFerry,
  monorail: mdiTrainVariant,
  funicular: mdiTrainCarPassenger,
  aerialLift: mdiGondola
}

const BASIC_TYPES: Record<number, TransitMode> = {
  0: 'tram',
  1: 'metro',
  2: 'train',
  3: 'bus',
  4: 'ferry',
  5: 'tram', // cable tram
  6: 'aerialLift',
  7: 'funicular',
  11: 'trolleybus',
  12: 'monorail'
}

// extended route types (Hierarchical Vehicle Type), by hundred
const EXTENDED_TYPES: Record<number, TransitMode> = {
  1: 'train', // railway
  2: 'bus', // coach
  3: 'train', // suburban railway
  4: 'metro', // urban railway
  5: 'metro',
  6: 'metro', // underground
  7: 'bus',
  8: 'trolleybus',
  9: 'tram',
  10: 'ferry', // water transport
  12: 'ferry',
  13: 'aerialLift',
  14: 'funicular'
}

/** GTFS `route_type` (basic or extended) → transit mode, null when unknown or absent. */
export function transitMode (routeType: unknown): TransitMode | null {
  if (routeType == null || routeType === '') return null
  const value = Number(routeType)
  if (!Number.isInteger(value) || value < 0) return null
  if (value < 100) return BASIC_TYPES[value] ?? null
  if (value === 405) return 'monorail'
  return EXTENDED_TYPES[Math.floor(value / 100)] ?? null
}

/**
 * Groups items by transit mode in MODE_ORDER, items without mode last (mode null).
 * Item order inside a group is kept.
 */
export function groupByMode<T> (items: T[], modeOf: (item: T) => TransitMode | null): { mode: TransitMode | null, items: T[] }[] {
  const groups = new Map<TransitMode | null, T[]>()
  for (const item of items) {
    const mode = modeOf(item)
    const group = groups.get(mode)
    if (group) group.push(item)
    else groups.set(mode, [item])
  }
  return [...MODE_ORDER, null]
    .filter(mode => groups.has(mode))
    .map(mode => ({ mode, items: groups.get(mode)! }))
}

/** Number of distinct modes, routes without mode not counted. */
export function countModes<T> (items: Iterable<T>, modeOf: (item: T) => TransitMode | null): number {
  const modes = new Set<TransitMode>()
  for (const item of items) {
    const mode = modeOf(item)
    if (mode) modes.add(mode)
  }
  return modes.size
}
