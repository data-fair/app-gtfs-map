import { test, expect } from '@playwright/test'
import { basemaps, resolveMapStyle, firstSymbolLayer, credentialsFor, mapLocale, createBasemapSwitch } from '../../src/utils/map-styles'

const ORIGIN = 'https://portal.example.org'

test('a tileserver style resolves against the origin of the site', () => {
  expect(resolveMapStyle('positron', ORIGIN)).toBe(`${ORIGIN}/tileserver/styles/positron/style.json`)
  expect(resolveMapStyle('admindiv', ORIGIN)).toBe(`${ORIGIN}/tileserver/styles/admindiv/style.json`)
})

test('local and IGN styles do not go through the tileserver', () => {
  expect(resolveMapStyle('void', ORIGIN)).toMatchObject({ version: 8, sources: {}, layers: [] })
  expect(resolveMapStyle('plan-ign-standard', ORIGIN)).toMatch(/^https:\/\/data\.geopf\.fr\//)
  const ortho = resolveMapStyle('plan-ign-ortho', ORIGIN)
  expect(ortho).toMatchObject({ sources: { 'ign-ortho': { type: 'raster', attribution: '© IGN' } } })
})

test('a local style is a fresh object at each call', () => {
  expect(resolveMapStyle('void', ORIGIN)).not.toBe(resolveMapStyle('void', ORIGIN))
})

test('basemap ids are unique and every IGN basemap carries its attribution', () => {
  const ids = basemaps.map(b => b.id)
  expect(new Set(ids).size).toBe(ids.length)
  for (const b of basemaps.filter(b => b.external)) expect(b.attribution).toEqual(['© IGN'])
  expect(basemaps.find(b => b.id === 'satellite')?.attribution).toContain('© IGN')
})

test('every tileserver basemap credits OpenStreetMap, void credits nothing', () => {
  for (const b of basemaps.filter(b => !b.external && b.id !== 'void')) {
    expect(b.attribution?.some(a => a.includes('&copy; OpenStreetMap contributors'))).toBe(true)
  }
  expect(basemaps.find(b => b.id === 'void')?.attribution).toBeUndefined()
})

test('aerial imagery counts as a dark basemap', () => {
  expect(basemaps.find(b => b.id === 'satellite')?.dark).toBe(true)
  expect(basemaps.find(b => b.id === 'plan-ign-ortho')?.dark).toBe(true)
})

test('data goes under the top block of labels, above roads', () => {
  const layers = [
    { id: 'background', type: 'background' },
    { id: 'housenumber', type: 'symbol' },
    { id: 'road', type: 'line' },
    { id: 'poi_label', type: 'symbol' },
    { id: 'place_city', type: 'symbol' }
  ]
  expect(firstSymbolLayer(layers)).toBe('poi_label')
  expect(firstSymbolLayer([{ id: 'background', type: 'background' }, { id: 'water', type: 'fill' }])).toBeUndefined()
  expect(firstSymbolLayer([])).toBeUndefined()
  expect(firstSymbolLayer([{ id: 'labels', type: 'symbol' }])).toBe('labels')
})

test('the session cookie is only sent to the site itself', () => {
  const transform = credentialsFor(ORIGIN)
  expect(transform(`${ORIGIN}/data-fair/api/v1/datasets/x/lines`)).toEqual({ url: `${ORIGIN}/data-fair/api/v1/datasets/x/lines`, credentials: 'include' })
  expect(transform('https://opendata.koumoul.com/data-fair/api/v1/datasets/x')).toEqual({ url: 'https://opendata.koumoul.com/data-fair/api/v1/datasets/x' })
  expect(transform(`${ORIGIN}.evil.org/data-fair/x`)).toEqual({ url: `${ORIGIN}.evil.org/data-fair/x` })
})

test('the maplibre UI follows the session language', () => {
  expect(mapLocale('fr')).toMatchObject({ 'Map.Title': 'Carte', 'NavigationControl.ZoomIn': 'Zoom avant' })
  expect(mapLocale('en')).toEqual({})
})

test('basemap switch: the last request wins, a failed style falls back to the last loaded one', () => {
  const listeners: Record<string, ((event: any) => void)[]> = {}
  const styles: unknown[] = []
  const map = {
    setStyle: (style: unknown) => { styles.push(style) },
    on: (type: string, listener: (event: any) => void) => { (listeners[type] ??= []).push(listener) }
  }
  const fire = (type: string, event: any = {}) => listeners[type]?.forEach(l => l(event))
  const basemap = createBasemapSwitch(map, 'klokantech-basic', ORIGIN)

  basemap.set('positron')
  basemap.set('dark-matter')
  expect(basemap.current()).toBe('dark-matter')
  fire('style.load')

  basemap.set('osm-bright')
  // a stale request of another style is not this one's failure (still logged)
  const consoleError = console.error
  console.error = () => {}
  fire('error', { error: { url: `${ORIGIN}/tileserver/styles/positron/style.json` } })
  console.error = consoleError
  expect(styles).toHaveLength(3)
  fire('error', { error: { url: `${ORIGIN}/tileserver/styles/osm-bright/style.json` } })
  expect(styles.at(-1)).toBe(`${ORIGIN}/tileserver/styles/dark-matter/style.json`)
  expect(basemap.current()).toBe('dark-matter')

  basemap.set('void')
  expect(styles.at(-1)).toMatchObject({ version: 8, layers: [] })
})

test('basemap switch: a style error without URL falls back, any other error is still logged', () => {
  const listeners: Record<string, ((event: any) => void)[]> = {}
  const styles: unknown[] = []
  const options: unknown[] = []
  const map = {
    setStyle: (style: unknown, option?: unknown) => { styles.push(style); options.push(option) },
    on: (type: string, listener: (event: any) => void) => { (listeners[type] ??= []).push(listener) }
  }
  const fire = (type: string, event: any = {}) => listeners[type]?.forEach(l => l(event))
  const logged: unknown[] = []
  const consoleError = console.error
  console.error = (error: unknown) => { logged.push(error) }
  try {
    const basemap = createBasemapSwitch(map, 'klokantech-basic', ORIGIN)
    const tileError = { error: { message: 'tile' }, sourceId: 'data' }
    fire('error', tileError)
    expect(logged).toEqual([tileError.error])

    const transformStyle = () => ({})
    basemap.set('positron', { transformStyle })
    fire('error', tileError)
    fire('error', { error: { url: `${ORIGIN}/tileserver/styles/positron/sprite.json` } })
    expect(styles).toHaveLength(1)
    expect(logged).toHaveLength(3)

    // invalid JSON or a validation error carry no URL
    fire('error', { error: { message: 'Unexpected token' } })
    expect(styles.at(-1)).toBe(`${ORIGIN}/tileserver/styles/klokantech-basic/style.json`)
    // the app options are kept, without a diff against a style that never loaded
    expect(options.at(-1)).toEqual({ transformStyle, diff: false })
    expect(basemap.current()).toBe('klokantech-basic')
    expect(logged).toHaveLength(3)
  } finally {
    console.error = consoleError
  }
})
