import { expect, test } from '@playwright/test'
import { countModes, groupByMode, transitMode } from '../../src/utils/transit-mode'

test.describe('transitMode', () => {
  test('types de base', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7, 11, 12].map(transitMode))
      .toEqual(['tram', 'metro', 'train', 'bus', 'ferry', 'tram', 'aerialLift', 'funicular', 'trolleybus', 'monorail'])
  })

  test('types étendus ramenés au mode de base', () => {
    expect(transitMode(100)).toBe('train')
    expect(transitMode(109)).toBe('train')
    expect(transitMode(200)).toBe('bus')
    expect(transitMode(401)).toBe('metro')
    expect(transitMode(405)).toBe('monorail')
    expect(transitMode(700)).toBe('bus')
    expect(transitMode(715)).toBe('bus')
    expect(transitMode(800)).toBe('trolleybus')
    expect(transitMode(900)).toBe('tram')
    expect(transitMode(1000)).toBe('ferry')
    expect(transitMode(1200)).toBe('ferry')
    expect(transitMode(1300)).toBe('aerialLift')
    expect(transitMode(1400)).toBe('funicular')
  })

  test('valeur inconnue ou absente : aucun mode', () => {
    for (const value of [undefined, null, '', 'bus', 8, 99, 1100, 1500, 1700, -1, 3.5]) {
      expect(transitMode(value)).toBeNull()
    }
  })

  test('accepte une chaîne numérique', () => {
    expect(transitMode('1')).toBe('metro')
  })
})

test.describe('groupByMode', () => {
  const routes = [
    { id: '1', mode: 'bus' as const },
    { id: 'a', mode: 'metro' as const },
    { id: 'x', mode: null },
    { id: '2', mode: 'bus' as const },
    { id: 'T', mode: 'tram' as const }
  ]

  test('ordre des codes route_type GTFS, lignes sans mode en dernier, ordre interne conservé', () => {
    const groups = groupByMode(routes, r => r.mode)
    expect(groups.map(g => g.mode)).toEqual(['tram', 'metro', 'bus', null])
    expect(groups[2]!.items.map(r => r.id)).toEqual(['1', '2'])
  })

  test('countModes ignore les lignes sans mode', () => {
    expect(countModes(routes, r => r.mode)).toBe(3)
    expect(countModes([{ mode: 'bus' }, { mode: null }], r => r.mode as 'bus' | null)).toBe(1)
  })
})
