#!/usr/bin/env node
// Records a GTFS-RT feed (VehiclePositions) to replay it later.
//
// Output: <OUT_DIR>/{record.json, index.json, positions.jsonl, frames/NNN.bin, static/...}
// - frames/: raw protobuf responses, one per tick
// - index.json: metadata of each frame (header, last vehicle timestamp, sha256...)
// - positions.jsonl: decoded positions, ready for an animation
// - static/: metadata dataset document + related datasets documents / GeoJSON, for an offline replay
//
// Environment variables: RT_URL, DURATION_MIN (20), INTERVAL_S (10), OUT_DIR,
// META_DATASET_ID, STATIC_API_BASE.
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import path from 'node:path'
import gtfsRealtimeBindings from 'gtfs-realtime-bindings'

const { transit_realtime: transitRealtime } = gtfsRealtimeBindings

const RT_URL = process.env.RT_URL ?? 'https://proxy.transport.data.gouv.fr/resource/star-rennes-integration-gtfs-rt-vehicle-position'
const DURATION_MIN = Number(process.env.DURATION_MIN ?? 20)
const INTERVAL_S = Number(process.env.INTERVAL_S ?? 10)
const STATIC_API_BASE = (process.env.STATIC_API_BASE ?? 'https://koumoul.com/data-fair/api/v1').replace(/\/$/, '')

const log = (message) => console.log(new Date().toISOString(), message)
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

function timestamp () {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}

const OUT_DIR = process.env.OUT_DIR ?? `recordings/star-${timestamp()}`

async function fetchWithRetry (url, attempts = 3) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`HTTP ${response.status} ${url}`)
      return response
    } catch (err) {
      lastError = err
      if (i < attempts - 1) await sleep(2000)
    }
  }
  throw lastError
}

/** Decodes a protobuf frame: usable positions + counters. */
function decodeFrame (buffer) {
  const feed = transitRealtime.FeedMessage.decode(new Uint8Array(buffer))
  const positions = []
  let tripUpdates = 0
  for (const entity of feed.entity ?? []) {
    if (entity.tripUpdate) tripUpdates++
    const vp = entity.vehicle
    const position = vp?.position
    if (position == null || position.latitude == null || position.longitude == null) continue
    positions.push({
      id: vp?.vehicle?.id ?? entity.id ?? '',
      routeId: vp?.trip?.routeId ?? '',
      lat: position.latitude,
      lng: position.longitude,
      ts: Number(vp?.timestamp ?? 0),
      speed: position.speed ?? null,
      bearing: position.bearing ?? null
    })
  }
  return { feed, positions, tripUpdates }
}

/** Role of a related dataset from its schema, like the app (titles can be renamed). */
function classify (doc) {
  const keys = new Set((doc.schema ?? []).map(field => field.key).filter(Boolean))
  if (keys.has('shape_id') || keys.has('route_short_name')) return 'shapes'
  if (keys.has('arrival_time') || keys.has('stop_sequence')) return 'stop-times'
  if (keys.has('stop_name')) return 'stops'
  return null
}

/** Downloads once the metadata dataset document and its related datasets (documents + GeoJSON). */
async function cacheStatic () {
  let metaId = process.env.META_DATASET_ID
  if (!metaId && existsSync('.dev-config.json')) {
    try {
      const config = JSON.parse(await readFile('.dev-config.json', 'utf8'))
      metaId = config.datasets?.[0]?.id
    } catch {}
  }
  if (!metaId) {
    log('static: no META_DATASET_ID nor .dev-config.json, cache skipped')
    return
  }
  try {
    const meta = await (await fetchWithRetry(`${STATIC_API_BASE}/datasets/${metaId}`)).json()
    const datasetsDir = path.join(OUT_DIR, 'static', 'datasets')
    await mkdir(datasetsDir, { recursive: true })
    await writeFile(path.join(OUT_DIR, 'static', 'meta.json'), JSON.stringify(meta, null, 2))
    log(`static: ${metaId} (metadata dataset)`)
    for (const rel of meta.relatedDatasets ?? []) {
      if (!rel?.id) continue
      const doc = await (await fetchWithRetry(`${STATIC_API_BASE}/datasets/${rel.id}`)).json()
      await writeFile(path.join(datasetsDir, `${rel.id}.json`), JSON.stringify(doc, null, 2))
      const kind = classify(doc)
      if (kind === 'shapes' || kind === 'stops') {
        const href = doc.href ?? `${STATIC_API_BASE}/datasets/${rel.id}`
        const text = await (await fetchWithRetry(`${href}/lines?format=geojson&size=10000`)).text()
        await writeFile(path.join(datasetsDir, `${rel.id}.geojson`), text)
        log(`static: ${rel.id} (${kind}) ${Math.round(text.length / 1024)} kB`)
      } else {
        log(`static: ${rel.id} (${kind ?? 'unclassified'}) document only`)
      }
    }
  } catch (err) {
    log(`static: cache failed (${err.message}), the replay will use online data`)
  }
}

async function main () {
  await mkdir(path.join(OUT_DIR, 'frames'), { recursive: true })
  const run = {
    url: RT_URL,
    intervalSeconds: INTERVAL_S,
    durationMinutes: DURATION_MIN,
    startedAt: new Date().toISOString()
  }
  await writeFile(path.join(OUT_DIR, 'record.json'), JSON.stringify(run, null, 2))
  log(`OUT_DIR=${OUT_DIR}`)
  await cacheStatic()

  const frames = []
  const startedAt = Date.now()
  const totalFrames = Math.max(1, Math.floor((DURATION_MIN * 60_000) / (INTERVAL_S * 1000)))
  let stopping = false
  const shouldStop = () => stopping
  process.on('SIGINT', () => { stopping = true })
  process.on('SIGTERM', () => { stopping = true })

  for (let number = 0; number < totalFrames && !shouldStop(); number++) {
    // ticks anchored on the start time: no drift and no burst at the end of the session
    const wait = startedAt + number * INTERVAL_S * 1000 - Date.now()
    if (wait > 0) await sleep(wait)
    const frameStart = Date.now()
    const file = `${String(number).padStart(3, '0')}.bin`
    const entry = {
      frame: number,
      file: `frames/${file}`,
      fetchedAt: new Date().toISOString(),
      fetchedAtMs: frameStart,
      error: null
    }
    try {
      const buffer = Buffer.from(await (await fetchWithRetry(RT_URL)).arrayBuffer())
      const { feed, positions, tripUpdates } = decodeFrame(buffer)
      await writeFile(path.join(OUT_DIR, 'frames', file), buffer)
      entry.bytes = buffer.length
      entry.sha256 = createHash('sha256').update(buffer).digest('hex')
      entry.entities = feed.entity?.length ?? 0
      entry.positions = positions.length
      entry.tripUpdates = tripUpdates
      entry.headerTimestamp = Number(feed.header?.timestamp ?? 0)
      entry.vehicleMaxTimestamp = positions.reduce((max, p) => Math.max(max, p.ts), 0)
      await appendFile(
        path.join(OUT_DIR, 'positions.jsonl'),
        JSON.stringify({ frame: number, vehicleMaxTimestamp: entry.vehicleMaxTimestamp, positions }) + '\n'
      )
      log(`#${String(number).padStart(3, '0')} ${entry.bytes} B | positions ${positions.length} | header ${new Date(entry.headerTimestamp * 1000).toISOString()} | vehicles ${new Date(entry.vehicleMaxTimestamp * 1000).toISOString()}`)
    } catch (err) {
      entry.error = err.message
      entry.positions = 0
      log(`#${String(number).padStart(3, '0')} ERROR ${err.message}`)
    }
    frames.push(entry)
    await writeFile(path.join(OUT_DIR, 'index.json'), JSON.stringify({ ...run, frames }, null, 2))
  }

  const snapshots = new Set(frames.map(f => f.vehicleMaxTimestamp).filter(Boolean)).size
  log(`done: ${frames.length} frames, ${snapshots} distinct snapshots in ${OUT_DIR}`)
}

main().catch((err) => {
  console.error(new Date().toISOString(), 'recorder failed', err)
  process.exit(1)
})
