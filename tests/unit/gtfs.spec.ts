import { expect, test } from '@playwright/test'
import type { FeatureCollection } from 'geojson'
import {
  applyFallbackColor,
  departuresQuery,
  geoJsonQuery,
  toGeoJsonLayer,
  buildRouteIndex,
  classifyDataset,
  colorsByShortName,
  contrastTextColor,
  datasetDocUrl,
  familyFromConfig,
  filterFeaturesByRoutes,
  filterPlatformStops,
  filterStopsByRouteNames,
  findRealtimeUrl,
  hasRealtimeAttachment,
  isTruncated,
  linksBackTo,
  normalizeColor,
  normalizeStopRoutes,
  parseGtfsTime,
  resolveAllowedRouteIds,
  selectDepartures
} from '../../src/composables/gtfs'

test.describe('URLs API', () => {
  test('datasetDocUrl s\'appuie sur apiUrl, jamais sur un chemin relatif', () => {
    expect(datasetDocUrl('https://host/data-fair/api/v1', 'abc')).toBe('https://host/data-fair/api/v1/datasets/abc')
    expect(datasetDocUrl('https://host/data-fair/api/v1/', 'abc')).toBe('https://host/data-fair/api/v1/datasets/abc')
  })

  test('departuresQuery filtre l\'arrêt avec le suffixe _eq', () => {
    const query = departuresQuery('S1', new Date(2026, 8, 9, 10, 30))
    expect(query.stop_id_eq).toBe('S1')
    expect(query).not.toHaveProperty('stop_id')
    expect(query.arrival_time_gte).toBe('10:30:00')
    // the data-fair API only understands "-field" for descending sort, not the ES "field:1" syntax
    expect(query.sort).toBe('arrival_time')
  })

  test('finalizedAt transmis quand le jeu en a un, absent sinon', () => {
    expect(departuresQuery('S1', new Date(), '2026-09-16T20:57:56.000Z').finalizedAt).toBe('2026-09-16T20:57:56.000Z')
    expect(departuresQuery('S1', new Date())).not.toHaveProperty('finalizedAt')
    expect(geoJsonQuery('2026-09-16T20:57:56.000Z')).toMatchObject({ format: 'geojson', finalizedAt: '2026-09-16T20:57:56.000Z' })
    expect(geoJsonQuery()).not.toHaveProperty('finalizedAt')
    expect(geoJsonQuery('')).not.toHaveProperty('finalizedAt')
  })

  test('toGeoJsonLayer écarte les objets sans géométrie et signale la troncature', () => {
    const raw = {
      type: 'FeatureCollection' as const,
      total: 3,
      features: [
        { type: 'Feature' as const, geometry: { type: 'Point' as const, coordinates: [0, 0] }, properties: {} },
        { type: 'Feature' as const, geometry: null as any, properties: {} }
      ]
    }
    const layer = toGeoJsonLayer(raw)
    expect(layer.collection.features).toHaveLength(1)
    expect(raw.features).toHaveLength(2)
    expect(layer.truncated).toBe(true)
  })
})

test.describe('classifyDataset', () => {
  test('classe les trois jeux liés d\'après leur schéma', () => {
    expect(classifyDataset({ schema: [{ key: 'geometry' }, { key: 'route_short_name' }] })).toBe('shapes')
    expect(classifyDataset({ schema: [{ key: 'trip_id' }, { key: 'arrival_time' }] })).toBe('stop-times')
    expect(classifyDataset({ schema: [{ key: 'stop_name' }, { key: 'routes' }] })).toBe('stops')
  })

  test('l\'ordre importe : un jeu d\'horaires avec stop_name reste « horaires »', () => {
    expect(classifyDataset({ schema: [{ key: 'stop_name' }, { key: 'arrival_time' }] })).toBe('stop-times')
  })

  test('repli sur le suffixe de titre posé par le traitement', () => {
    expect(classifyDataset({ schema: [], title: 'Réseau Kicéo - tracés' })).toBe('shapes')
    expect(classifyDataset({ schema: [], title: 'Réseau Kicéo - arrêts' })).toBe('stops')
    expect(classifyDataset({ schema: [], title: 'Réseau Kicéo - horaires' })).toBe('stop-times')
  })

  test('un jeu de métadonnées (sans schéma) n\'est classé dans aucun rôle', () => {
    expect(classifyDataset({ schema: [], title: 'Réseau Kicéo - métadonnées' })).toBeNull()
  })
})

test.describe('findRealtimeUrl', () => {
  test('préfère le lien public porté par la pièce jointe distante', () => {
    const url = findRealtimeUrl({
      id: 'gtfs-meta',
      href: 'https://api.interne.example/api/v1/datasets/gtfs-meta',
      attachments: [
        { type: 'file', name: 'gtfs.zip' },
        {
          type: 'remoteFile',
          name: 'gtfs-rt.protobuf',
          url: 'https://data.example/api/v1/datasets/gtfs-meta/metadata-attachments/gtfs-rt.protobuf'
        }
      ]
    })
    expect(url).toBe('https://data.example/api/v1/datasets/gtfs-meta/metadata-attachments/gtfs-rt.protobuf')
  })

  test('reconstruit l\'URL proxifiée quand le lien public est absent', () => {
    const url = findRealtimeUrl({
      id: 'gtfs-meta',
      href: 'api/v1/datasets/gtfs-meta',
      attachments: [
        { type: 'file', name: 'gtfs.zip' },
        { type: 'remoteFile', name: 'gtfs-rt.protobuf' }
      ]
    })
    expect(url).toBe('api/v1/datasets/gtfs-meta/metadata-attachments/gtfs-rt.protobuf')
  })

  test('préfère la pièce jointe préfixée gtfs-rt parmi les pièces distantes', () => {
    const url = findRealtimeUrl({
      id: 'gtfs-meta',
      attachments: [
        { type: 'remoteFile', name: 'autre.flux' },
        { type: 'remoteFile', name: 'gtfs-rt-vehicle.protobuf' }
      ]
    })
    expect(url).toBe('api/v1/datasets/gtfs-meta/metadata-attachments/gtfs-rt-vehicle.protobuf')
  })

  test('retourne null sans pièce jointe distante', () => {
    expect(findRealtimeUrl({ id: 'x', attachments: [{ type: 'file', name: 'a.txt' }] })).toBeNull()
    expect(findRealtimeUrl({ id: 'x' })).toBeNull()
  })

  test('ignore une pièce jointe distante qui n\'est pas le flux gtfs-rt', () => {
    expect(findRealtimeUrl({ id: 'x', attachments: [{ type: 'remoteFile', name: 'autre.flux' }] })).toBeNull()
  })

  test('hasRealtimeAttachment ne retient que le flux gtfs-rt distant', () => {
    expect(hasRealtimeAttachment({ id: 'x', attachments: [{ type: 'remoteFile', name: 'gtfs-rt.protobuf' }] })).toBe(true)
    expect(hasRealtimeAttachment({ id: 'x', attachments: [{ type: 'remoteFile', name: 'autre.flux' }] })).toBe(false)
    expect(hasRealtimeAttachment({ id: 'x', attachments: [{ type: 'file', name: 'gtfs-rt.protobuf' }] })).toBe(false)
  })
})

test.describe('famille de jeux', () => {
  test('linksBackTo exige un lien retour vers le jeu sélectionné', () => {
    expect(linksBackTo({ relatedDatasets: [{ id: 'meta' }] }, 'meta')).toBe(true)
    expect(linksBackTo({ relatedDatasets: [{ id: 'autre' }] }, 'meta')).toBe(false)
    expect(linksBackTo({}, 'meta')).toBe(false)
    expect(linksBackTo({ relatedDatasets: [{ id: 'meta' }] }, undefined)).toBe(false)
  })

  test('familyFromConfig classifie les entrées liées du tableau datasets, sans l\'entrée 0', () => {
    const datasets = [
      { id: 'meta', href: 'api/v1/datasets/meta', title: 'Réseau - métadonnées', schema: [] },
      { id: 'shapes', href: 'api/v1/datasets/shapes', title: 'Réseau - tracés', schema: [{ key: 'route_short_name' }] },
      { id: 'stops', href: 'api/v1/datasets/stops', title: 'Réseau - arrêts', schema: [{ key: 'stop_name' }] },
      { id: 'stoptimes', href: 'api/v1/datasets/stoptimes', title: 'Réseau - horaires', schema: [{ key: 'arrival_time' }] }
    ]
    const family = familyFromConfig(datasets)
    expect(Object.keys(family).sort()).toEqual(['shapes', 'stop-times', 'stops'])
    expect(family.shapes?.id).toBe('shapes')
    expect(family.stops?.id).toBe('stops')
    expect(family['stop-times']?.id).toBe('stoptimes')
  })

  test('familyFromConfig ignore les entrées non reconnues et tolère un tableau absent', () => {
    expect(familyFromConfig([{ id: 'meta' }, { id: 'autre', href: 'x', title: 'Autre jeu', schema: [] }] as any)).toEqual({})
    expect(familyFromConfig(undefined)).toEqual({})
    expect(familyFromConfig([undefined, { id: 's', href: 'x', title: 'S - tracés', schema: [] }] as any).shapes?.id).toBe('s')
  })

  test('isTruncated compare le total au nombre d\'objets renvoyés', () => {
    expect(isTruncated(10001, 10000)).toBe(true)
    expect(isTruncated(10000, 10000)).toBe(false)
    expect(isTruncated(null, 10)).toBe(false)
    expect(isTruncated(undefined, 10)).toBe(false)
  })
})

test.describe('couleurs GTFS', () => {
  test('normalizeColor accepte les hex 6 chiffres avec ou sans #', () => {
    expect(normalizeColor('00AAFF')).toBe('#00AAFF')
    expect(normalizeColor('#00aaff')).toBe('#00aaff')
    expect(normalizeColor('')).toBeNull()
    expect(normalizeColor('bleu')).toBeNull()
    expect(normalizeColor('#12345')).toBeNull()
  })

  test('applyFallbackColor normalise route_color et applique le repli', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { route_color: 'FF8800' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { route_color: '' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }
      ] as FeatureCollection['features']
    }
    applyFallbackColor(fc, '#1976D2')
    expect(fc.features[0].properties!.color).toBe('#FF8800')
    expect(fc.features[1].properties!.color).toBe('#1976D2')
    expect(fc.features[2].properties!.color).toBe('#1976D2')
  })

  test('applyFallbackColor turns an integer route_id into a string', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { route_id: 91 } }]
    }
    applyFallbackColor(fc, '#1976D2')
    expect(fc.features[0].properties!.route_id).toBe('91')
  })

  test('buildRouteIndex indexe par route_id avec le nom et la couleur', () => {
    const fc = {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, geometry: null as any, properties: { route_id: 'A', route_short_name: '1', route_long_name: 'Gare - Plage', route_color: 'FF8800' } },
        { type: 'Feature' as const, geometry: null as any, properties: { route_id: 'A', route_short_name: '1', route_color: 'FF8800' } },
        { type: 'Feature' as const, geometry: null as any, properties: { route_id: 'B', route_short_name: '2' } }
      ]
    }
    const index = buildRouteIndex(fc, '#1976D2')
    expect(index.size).toBe(2)
    expect(index.get('A')).toMatchObject({ shortName: '1', longName: 'Gare - Plage', color: '#FF8800' })
    expect(index.get('B')?.color).toBe('#1976D2')
  })

  test('colorsByShortName indexe les couleurs par nom court, premier doublon conservé', () => {
    const fc = {
      type: 'FeatureCollection' as const,
      features: [
        { type: 'Feature' as const, geometry: null as any, properties: { route_id: 'A', route_short_name: '1', route_color: 'FF8800' } },
        { type: 'Feature' as const, geometry: null as any, properties: { route_id: 'B', route_short_name: '2', route_color: '33AA33' } },
        { type: 'Feature' as const, geometry: null as any, properties: { route_id: 'A2', route_short_name: '1', route_color: '000000' } },
        { type: 'Feature' as const, geometry: null as any, properties: { route_id: 'C', route_short_name: '', route_color: 'FFFFFF' } }
      ]
    }
    const colors = colorsByShortName(buildRouteIndex(fc, '#1976D2'))
    expect(colors.get('1')).toBe('#FF8800')
    expect(colors.get('2')).toBe('#33AA33')
    // guard: an empty short name is not indexed
    const withEmpty = colorsByShortName(new Map([
      ['C', { routeId: 'C', shortName: '', longName: '', color: '#FFFFFF' }]
    ]))
    expect(withEmpty.size).toBe(0)
  })

  test('filterPlatformStops retire les stations parentes, garde plateformes et flux sans location_type', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { stop_id: 'S1', location_type: '0' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0.0001] }, properties: { stop_id: 'SP', location_type: '1' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0.0002] }, properties: { stop_id: 'S2', location_type: '0' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0.0003] }, properties: { stop_id: 'S3' } }
      ] as FeatureCollection['features']
    }
    const filtered = filterPlatformStops(fc)
    expect(filtered?.features.map(f => f.properties!.stop_id)).toEqual(['S1', 'S2', 'S3'])
    // the original collection is not mutated
    expect(fc.features).toHaveLength(4)
  })

  test('filterPlatformStops tolère une collection absente', () => {
    expect(filterPlatformStops(null)).toBeNull()
  })

  test('contrastTextColor choisit un texte lisible selon la luminance', () => {
    expect(contrastTextColor('#FFFFFF')).toBe('#111111')
    expect(contrastTextColor('#000000')).toBe('#ffffff')
    expect(contrastTextColor('FF8800')).toBe('#111111')
    expect(contrastTextColor('nawak')).toBe('#ffffff')
  })
})

test.describe('filtre de lignes', () => {
  const allIds = ['A', 'B', 'C']

  test('resolveAllowedRouteIds : mode « toutes » ou liste vide = pas de filtre', () => {
    expect(resolveAllowedRouteIds('all', ['A'], allIds)).toBeNull()
    expect(resolveAllowedRouteIds(undefined, ['A'], allIds)).toBeNull()
    expect(resolveAllowedRouteIds('include', [], allIds)).toBeNull()
    expect(resolveAllowedRouteIds('exclude', [], allIds)).toBeNull()
  })

  test('resolveAllowedRouteIds : inclusion et exclusion', () => {
    expect([...resolveAllowedRouteIds('include', ['A', 'B'], allIds)!]).toEqual(['A', 'B'])
    expect([...resolveAllowedRouteIds('exclude', ['B'], allIds)!]).toEqual(['A', 'C'])
    // numeric ids: comparison goes through String()
    expect([...resolveAllowedRouteIds('include', [1 as any], [1 as any])!]).toEqual(['1'])
    expect([...resolveAllowedRouteIds('exclude', ['1'], [1 as any, 2 as any])!]).toEqual(['2'])
  })

  test('filterFeaturesByRoutes retire les tracés des lignes masquées', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { route_id: 'A' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: { route_id: 'B' } },
        { type: 'Feature', geometry: { type: 'LineString', coordinates: [[0, 0], [1, 1]] }, properties: {} }
      ] as FeatureCollection['features']
    }
    const filtered = filterFeaturesByRoutes(fc, 'route_id', new Set(['A']))
    expect(filtered?.features.map(f => f.properties!.route_id)).toEqual(['A'])
    // original collection untouched, and no filter = same object
    expect(fc.features).toHaveLength(3)
    expect(filterFeaturesByRoutes(fc, 'route_id', null)).toBe(fc)
  })

  test('filterStopsByRouteNames retire les arrêts dont aucune ligne n\'est autorisée', () => {
    const fc: FeatureCollection = {
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { stop_id: 'S1', routes: '1;2' } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { stop_id: 'S2', routes: ['2'] } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [0, 0] }, properties: { stop_id: 'S3' } }
      ] as FeatureCollection['features']
    }
    const filtered = filterStopsByRouteNames(fc, new Set(['1']))
    expect(filtered?.features.map(f => f.properties!.stop_id)).toEqual(['S1'])
    expect(filterStopsByRouteNames(fc, null)).toBe(fc)
    expect(filterStopsByRouteNames(null, new Set(['1']))).toBeNull()
  })
})

test.describe('prochains passages', () => {
  // Wednesday, September 9 2026, 10:30
  const now = new Date(2026, 8, 9, 10, 30, 0)

  test('parseGtfsTime gère les heures au-delà de 24', () => {
    expect(parseGtfsTime('10:30:00')).toBe(37800)
    expect(parseGtfsTime('25:10:00')).toBe(90600)
    expect(parseGtfsTime('')).toBeNull()
    expect(parseGtfsTime('nonsense')).toBeNull()
  })

  test('ne garde que les passages à venir du jour, triés et dédoublonnés', () => {
    const rows = [
      { route_name: '1', arrival_time: '09:00:00', week: 'Mercredi' },
      { route_name: '1', arrival_time: '10:45:00', week: 'Mercredi' },
      { route_name: '1', arrival_time: '10:45:00', week: 'Mercredi' },
      { route_name: '2', arrival_time: '12:00:00', week: 'Mercredi' }
    ]
    const departures = selectDepartures(rows, now)
    expect(departures.map(d => d.time)).toEqual(['10:45', '12:00'])
  })

  test('restreint les passages aux lignes autorisées', () => {
    const rows = [
      { route_name: '1', arrival_time: '11:00:00', week: 'Mercredi' },
      { route_name: '2', arrival_time: '11:10:00', week: 'Mercredi' },
      { arrival_time: '11:20:00', week: 'Mercredi' }
    ]
    expect(selectDepartures(rows, now, new Set(['1'])).map(d => d.routeName)).toEqual(['1'])
    expect(selectDepartures(rows, now, null)).toHaveLength(3)
    // a departure without route name is hidden by an active filter
    expect(selectDepartures(rows, now, new Set(['1'])).every(d => d.routeName === '1')).toBe(true)
  })

  test('applique la validité du service : jour de la semaine et période', () => {
    const rows = [
      { route_name: '1', arrival_time: '11:00:00', week: 'Lundi;Mardi' },
      { route_name: '1', arrival_time: '11:10:00', week: 'Mercredi', start_date: '2026-09-10' },
      { route_name: '1', arrival_time: '11:20:00', week: 'Mercredi', end_date: '2026-09-01' },
      { route_name: '1', arrival_time: '11:30:00', week: 'Mercredi' }
    ]
    const departures = selectDepartures(rows, now)
    expect(departures.map(d => d.time)).toEqual(['11:30'])
  })

  test('un passage à 25:10 apparaît comme 01:10 (service passant minuit)', () => {
    const lateNow = new Date(2026, 8, 9, 0, 0, 0)
    const rows = [{ route_name: 'N', arrival_time: '25:10:00', week: 'Mercredi' }]
    const departures = selectDepartures(rows, lateNow)
    expect(departures[0].time).toBe('01:10')
  })

  test('tolère 30 secondes de battement autour de maintenant', () => {
    const rows = [{ route_name: '1', arrival_time: '10:30:20', week: 'Mercredi' }]
    expect(selectDepartures(rows, now)).toHaveLength(1)
    const tooLate = [{ route_name: '1', arrival_time: '10:29:29', week: 'Mercredi' }]
    expect(selectDepartures(tooLate, now)).toHaveLength(0)
  })

  test('borne le nombre de passages affichés à 6', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({ route_name: '1', arrival_time: `11:${String(i).padStart(2, '0')}:00`, week: 'Mercredi' }))
    expect(selectDepartures(rows, now)).toHaveLength(6)
  })
})

test.describe('normalizeStopRoutes', () => {
  test('accepte le tableau renvoyé par l\'API GeoJSON', () => {
    expect(normalizeStopRoutes(['1', '2'])).toEqual(['1', '2'])
  })

  test('accepte la chaîne séparée par des points-virgules de l\'API JSON', () => {
    expect(normalizeStopRoutes('1;2')).toEqual(['1', '2'])
  })

  test('nettoie les segments vides et les espaces', () => {
    expect(normalizeStopRoutes('1;;2;')).toEqual(['1', '2'])
    expect(normalizeStopRoutes(['1', '', ' 2 '])).toEqual(['1', '2'])
  })

  test('tolère une valeur absente ou d\'un autre type', () => {
    expect(normalizeStopRoutes(undefined)).toEqual([])
    expect(normalizeStopRoutes(null)).toEqual([])
    expect(normalizeStopRoutes(42)).toEqual([])
  })
})
