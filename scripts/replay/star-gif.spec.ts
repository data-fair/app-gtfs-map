import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'

// Rejoue un enregistrement `scripts/record-rt.mjs` dans l'app et produit un GIF :
// une frame toutes les ~20 s (dédoublonnage sur le dernier timestamp véhicule),
// lue sur `gtfs-vehicles`, puis assemblée par ffmpeg.
// Lancement : npx playwright test --config scripts/replay.config.ts
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const FALLBACK_COLOR = '#1976D2'

interface FrameEntry {
  frame: number
  file: string
  vehicleMaxTimestamp: number
  positions: number
  error: string | null
}

interface Position {
  id: string
  routeId: string
  lat: number
  lng: number
  ts: number
  speed: number | null
  bearing: number | null
}

/** Dernier enregistrement `recordings/star-*` terminé, ou RECORDING_DIR. */
function latestRecording (): string {
  if (process.env.RECORDING_DIR) return path.resolve(process.env.RECORDING_DIR)
  const base = path.join(REPO_ROOT, 'recordings')
  const dirs = readdirSync(base)
    .filter(name => name.startsWith('star-') && existsSync(path.join(base, name, 'index.json')))
    .sort()
  if (!dirs.length) throw new Error(`aucun enregistrement star-* dans ${base}`)
  return path.join(base, dirs[dirs.length - 1])
}

/** Une frame par snapshot de positions : le flux republie les positions ~toutes les 20 s. */
function selectFrames (frames: FrameEntry[]): FrameEntry[] {
  const selected: FrameEntry[] = []
  let lastTimestamp = -Infinity
  for (const frame of frames) {
    if (frame.error || !frame.positions) continue
    if (frame.vehicleMaxTimestamp > lastTimestamp + 5) {
      selected.push(frame)
      lastTimestamp = frame.vehicleMaxTimestamp
    }
  }
  return selected
}

/** « 00AAFF » ou « #00AAFF » → couleur CSS, sinon null. */
function normalizeColor (raw?: string | null): string | null {
  const value = (raw ?? '').trim()
  if (!/^#?[0-9a-fA-F]{6}$/.test(value)) return null
  return value.startsWith('#') ? value : `#${value}`
}

test('génère un GIF animé depuis un enregistrement GTFS-RT', async ({ page }) => {
  const recording = latestRecording()
  const index = JSON.parse(readFileSync(path.join(recording, 'index.json'), 'utf8'))
  const selected = selectFrames(index.frames as FrameEntry[])
  expect(selected.length).toBeGreaterThan(1)

  /** Attend la fin du rendu (tuiles + couches) et deux frames d'animation. */
  const waitForIdle = () => page.evaluate(() => new Promise<void>((resolve) => {
    const map = (window as any).__MAP__
    let done = false
    const finish = () => {
      if (done) return
      done = true
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }
    map.once('idle', finish)
    setTimeout(finish, 2000)
  }))

  // positions décodées, indexées par frame
  const positionsByFrame = new Map<number, Position[]>()
  for (const line of readFileSync(path.join(recording, 'positions.jsonl'), 'utf8').trim().split('\n')) {
    const entry = JSON.parse(line)
    positionsByFrame.set(entry.frame, entry.positions)
  }

  // données statiques mises en cache par le recorder
  const meta = JSON.parse(readFileSync(path.join(recording, 'static/meta.json'), 'utf8'))
  const docs = new Map<string, any>()
  const geojsons = new Map<string, any>()
  const datasetsDir = path.join(recording, 'static/datasets')
  for (const name of readdirSync(datasetsDir)) {
    const id = name.replace(/\.(json|geojson)$/, '')
    const content = JSON.parse(readFileSync(path.join(datasetsDir, name), 'utf8'))
    if (name.endsWith('.geojson')) geojsons.set(id, content)
    else docs.set(id, content)
  }
  docs.set(meta.id, meta)

  // couleurs et noms de lignes, comme buildRouteIndex de l'app
  const fallbackColor = JSON.parse(readFileSync(path.join(REPO_ROOT, '.dev-config.json'), 'utf8'))?.map?.fallbackColor ?? FALLBACK_COLOR
  const routeIndex = new Map<string, { name: string, color: string }>()
  for (const [id, doc] of docs) {
    const keys = new Set((doc.schema ?? []).map((field: any) => field.key))
    if (!keys.has('shape_id')) continue
    for (const feature of geojsons.get(id)?.features ?? []) {
      const props = feature.properties ?? {}
      if (props.route_id && !routeIndex.has(props.route_id)) {
        routeIndex.set(props.route_id, {
          name: props.route_short_name || props.route_long_name || props.route_id,
          color: normalizeColor(props.route_color) ?? fallbackColor
        })
      }
    }
  }

  const featureCollection = (frame: number) => ({
    type: 'FeatureCollection',
    features: (positionsByFrame.get(frame) ?? []).map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        routeId: p.routeId,
        routeName: routeIndex.get(p.routeId)?.name ?? p.routeId,
        color: routeIndex.get(p.routeId)?.color ?? fallbackColor,
        speed: p.speed != null ? Math.round(p.speed * 3.6) : null,
        bearing: p.bearing,
        timestamp: p.ts
      }
    }))
  })

  // bbox des positions pour cadrer la carte sur les véhicules enregistrés
  const bbox = { minLng: Infinity, minLat: Infinity, maxLng: -Infinity, maxLat: -Infinity }
  for (const frame of selected) {
    for (const p of positionsByFrame.get(frame.frame) ?? []) {
      bbox.minLng = Math.min(bbox.minLng, p.lng)
      bbox.minLat = Math.min(bbox.minLat, p.lat)
      bbox.maxLng = Math.max(bbox.maxLng, p.lng)
      bbox.maxLat = Math.max(bbox.maxLat, p.lat)
    }
  }

  // configuration rejouée : jeux statiques locaux, temps réel désactivé (on pilote la source)
  const devConfig = JSON.parse(readFileSync(path.join(REPO_ROOT, '.dev-config.json'), 'utf8'))
  const datasets = [
    { id: meta.id, href: `/api/v1/datasets/${meta.id}`, title: meta.title },
    ...(meta.relatedDatasets ?? [])
      .map((rel: any) => {
        const doc = docs.get(rel.id)
        return doc ? { id: doc.id, href: `/api/v1/datasets/${doc.id}`, title: doc.title, schema: doc.schema } : null
      })
      .filter(Boolean)
  ]
  const configuration = {
    datasets,
    realtime: { ...(devConfig.realtime ?? {}), enabled: false },
    // véhicules agrandis pour l'animation (taille pensée pour la carte interactive)
    map: { ...(devConfig.map ?? {}), vehicleSize: Number(process.env.GIF_VEHICLE_SIZE ?? 16) },
    panelPosition: devConfig.panelPosition ?? 'right',
    largePanel: devConfig.largePanel ?? false
  }

  const publicSiteInfo = {
    main: 'http://localhost',
    isAccountMain: true,
    logo: null,
    authMode: 'main',
    owner: { type: 'organization', id: 'orga' },
    theme: { colors: { primary: '#1976D2', secondary: '#424242', accent: '#82B1FF' } }
  }
  await page.route('**/simple-directory/api/sites/_public.js', route => route.fulfill({
    contentType: 'application/javascript',
    body: `window.__PUBLIC_SITE_INFO = ${JSON.stringify(publicSiteInfo)};`
  }))
  await page.route('**/simple-directory/api/sites/_theme.css', route => route.fulfill({ contentType: 'text/css', body: '' }))
  // le fond de carte de la config courante (klokantech-basic) vit sur le tileserver data-fair :
  // on le proxifie côté serveur pour s'affranchir du CORS
  await page.route('**/tileserver/**', async (route) => {
    const url = new URL(route.request().url())
    try {
      const response = await fetch(`https://koumoul.com${url.pathname}${url.search}`)
      const body = Buffer.from(await response.arrayBuffer())
      await route.fulfill({
        status: response.status,
        headers: { 'content-type': response.headers.get('content-type') ?? 'application/octet-stream' },
        body
      })
    } catch {
      await route.abort()
    }
  })
  await page.route('**/api/v1/datasets/**', async (route) => {
    const segments = new URL(route.request().url()).pathname.split('/').filter(Boolean)
    const id = decodeURIComponent(segments[3] ?? '')
    if (segments[4] === 'lines') {
      const geojson = geojsons.get(id)
      await route.fulfill(geojson
        ? { json: geojson }
        : { json: { type: 'FeatureCollection', features: [] } })
      return
    }
    const doc = docs.get(id)
    await route.fulfill(doc ? { json: doc } : { status: 404, body: 'not found' })
  })

  await page.addInitScript(({ appConfig }) => {
    (window as any).APPLICATION = {
      id: 'replay-star',
      title: 'Rejeu STAR',
      slug: 'replay-star',
      href: '/api/v1/applications/replay-star',
      exposedUrl: '/app/replay-star/',
      apiUrl: '/api/v1',
      wsUrl: '',
      owner: { type: 'organization', id: 'orga' },
      configuration: appConfig
    }
  }, { appConfig: configuration })

  await page.goto('/')
  await expect(page.locator('.maplibregl-canvas')).toBeVisible({ timeout: 30000 })
  await page.waitForFunction(() => !!(window as any).__MAP__?.getLayer('gtfs-vehicles-circle'), null, { timeout: 30000 })
  await expect(page.locator('.route-item').first()).toBeVisible({ timeout: 30000 })
  // les véhicules passent au-dessus des arrêts pour rester lisibles en animation
  await page.evaluate(() => (window as any).__MAP__.moveLayer('gtfs-vehicles-circle'))

  // carte en plein cadre, sans panneau ni commandes, pour un GIF propre
  await page.addStyleTag({
    content: `
      .navigation-side, .v-col:has(.navigation-side) { display: none !important; }
      .v-row > .v-col { flex: 0 0 100% !important; max-width: 100% !important; }
      .v-main { padding: 0 !important; }
      .maplibregl-ctrl-top-right, .maplibregl-ctrl-bottom-right { display: none !important; }
    `
  })

  if (!Number.isFinite(bbox.minLng)) throw new Error('aucune position exploitable dans l\'enregistrement')
  await page.evaluate((bounds) => {
    const map = (window as any).__MAP__
    map.fitBounds([[bounds.minLng, bounds.minLat], [bounds.maxLng, bounds.maxLat]], { padding: 40, animate: false, maxZoom: 12 })
  }, bbox)
  await waitForIdle()

  const gifDir = path.join(recording, 'gif')
  rmSync(gifDir, { recursive: true, force: true })
  mkdirSync(path.join(gifDir, 'frames'), { recursive: true })

  for (let i = 0; i < selected.length; i++) {
    await page.evaluate((collection) => {
      const map = (window as any).__MAP__
      map.getSource('gtfs-vehicles').setData(collection)
    }, featureCollection(selected[i].frame))
    await waitForIdle()
    if (i === 0) {
      // garde-fou : au moins un véhicule effectivement rendu sur la première frame
      const rendered = await page.evaluate(() =>
        (window as any).__MAP__.queryRenderedFeatures({ layers: ['gtfs-vehicles-circle'] }).length)
      expect(rendered).toBeGreaterThan(0)
    }
    await page.screenshot({ path: path.join(gifDir, 'frames', `${String(i).padStart(3, '0')}.png`) })
    if ((i + 1) % 10 === 0 || i === selected.length - 1) console.log(`frame ${i + 1}/${selected.length}`)
  }

  const gifPath = path.join(gifDir, 'animation.gif')
  execFileSync('ffmpeg', [
    '-y',
    '-framerate', '15',
    '-i', path.join(gifDir, 'frames', '%03d.png'),
    '-vf', 'split[s0][s1];[s0]palettegen=max_colors=256[p];[s1][p]paletteuse=dither=sierra2_4a',
    '-loop', '0',
    gifPath
  ], { stdio: 'inherit' })

  expect(existsSync(gifPath)).toBe(true)
  console.log(`GIF généré : ${gifPath} (${selected.length} frames, 15 fps)`)
})
