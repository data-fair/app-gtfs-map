import { expect, test } from '@playwright/test'
import type { FeatureCollection } from 'geojson'
import {
  applyFallbackColor,
  buildDeparturesUrl,
  buildRouteIndex,
  classifyDataset,
  contrastTextColor,
  datasetDocUrl,
  findRealtimeUrl,
  hasRealtimeAttachment,
  isTruncated,
  kindToConfigField,
  linksBackTo,
  normalizeColor,
  parseGtfsTime,
  selectDepartures
} from '../../src/composables/gtfs'

test.describe('URLs API', () => {
  test('datasetDocUrl s\'appuie sur apiUrl, jamais sur un chemin relatif', () => {
    expect(datasetDocUrl('https://host/data-fair/api/v1', 'abc')).toBe('https://host/data-fair/api/v1/datasets/abc')
    expect(datasetDocUrl('https://host/data-fair/api/v1/', 'abc')).toBe('https://host/data-fair/api/v1/datasets/abc')
  })

  test('buildDeparturesUrl filtre l\'arrêt avec le suffixe _eq', () => {
    const url = buildDeparturesUrl('https://host/api/v1/datasets/horaires', 'S1', new Date(2026, 8, 9, 10, 30))
    expect(url).toContain('stop_id_eq=S1')
    expect(url).not.toMatch(/[?&]stop_id=/)
    expect(url).toContain('arrival_time_gte=10%3A30%3A00')
    expect(url).toContain('sort=arrival_time:1')
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

  test('nom du champ de configuration pour chaque rôle', () => {
    expect(kindToConfigField('shapes')).toBe('shapesDataset')
    expect(kindToConfigField('stops')).toBe('stopsDataset')
    expect(kindToConfigField('stop-times')).toBe('stopTimesDataset')
  })
})

test.describe('findRealtimeUrl', () => {
  test('construit l\'URL proxifiée de la pièce jointe distante gtfs-rt', () => {
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

  test('contrastTextColor choisit un texte lisible selon la luminance', () => {
    expect(contrastTextColor('#FFFFFF')).toBe('#111111')
    expect(contrastTextColor('#000000')).toBe('#ffffff')
    expect(contrastTextColor('FF8800')).toBe('#111111')
    expect(contrastTextColor('nawak')).toBe('#ffffff')
  })
})

test.describe('prochains passages', () => {
  // mercredi 9 septembre 2026, 10 h 30
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
