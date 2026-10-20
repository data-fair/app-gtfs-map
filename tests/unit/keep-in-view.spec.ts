import type { Map } from 'maplibre-gl'
import { test, expect } from '@playwright/test'
import { keepInView, withCover } from '../../src/utils/keep-in-view'

// a 600 x 400 map where a lngLat is its pixel position
function fakeMap () {
  const listeners: Record<string, ((e?: any) => void)[]> = {}
  const state = { moving: false, pans: [] as [number, number][] }
  const map = {
    on: (type: string, listener: (e?: any) => void) => { (listeners[type] ??= []).push(listener) },
    once: (type: string, listener: (e?: any) => void) => {
      const wrapped = (e?: any) => {
        listeners[type] = listeners[type].filter(l => l !== wrapped)
        listener(e)
      }
      map.on(type, wrapped)
    },
    fire: (type: string, e?: any) => listeners[type]?.slice().forEach(l => l(e)),
    isMoving: () => state.moving,
    project: (p: { lng: number, lat: number }) => ({ x: p.lng, y: p.lat }),
    getContainer: () => ({ clientWidth: 600, clientHeight: 400 }),
    panBy: (offset: [number, number]) => { state.pans.push(offset) }
  }
  return { map, state, asMap: map as unknown as Map }
}

const wait = () => new Promise(resolve => setTimeout(resolve, 150))

test('a padding plus the cover, per side', () => {
  expect(withCover(10, { right: 280 })).toEqual({ top: 10, bottom: 10, left: 10, right: 290 })
  expect(withCover({ top: 5 })).toEqual({ top: 5, bottom: 0, left: 0, right: 0 })
})

test('a resize brings the clicked element back into view, nothing when it is visible', async () => {
  const { map, state, asMap } = fakeMap()
  keepInView(asMap, { selected: () => true })
  map.fire('click', { lngLat: { lng: 590, lat: 200 } })
  map.fire('resize')
  await wait()
  expect(state.pans).toEqual([[30, 0]])
  map.fire('click', { lngLat: { lng: 300, lat: 200 } })
  map.fire('resize')
  await wait()
  expect(state.pans).toHaveLength(1)
})

test('the covered side counts as hidden', async () => {
  const { map, state, asMap } = fakeMap()
  const { check } = keepInView(asMap, { selected: () => true, cover: () => ({ right: 280 }) })
  map.fire('click', { lngLat: { lng: 400, lat: 20 } })
  check()
  await wait()
  expect(state.pans).toEqual([[120, -20]])
})

test('nothing without a selection', async () => {
  const { map, state, asMap } = fakeMap()
  keepInView(asMap, { selected: () => false })
  map.fire('click', { lngLat: { lng: 590, lat: 200 } })
  map.fire('resize')
  await wait()
  expect(state.pans).toEqual([])
})

test('a running camera move ends first', async () => {
  const { map, state, asMap } = fakeMap()
  keepInView(asMap, { selected: () => true })
  map.fire('click', { lngLat: { lng: 5, lat: 200 } })
  state.moving = true
  map.fire('resize')
  await wait()
  expect(state.pans).toEqual([])
  state.moving = false
  map.fire('moveend')
  await wait()
  expect(state.pans).toEqual([[-35, 0]])
})
