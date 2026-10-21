import { test, expect } from '@playwright/test'
import { franceBounds, readViewParams, resolveInitialView, writeViewParams } from '../../src/utils/initial-view'

test('a shared link needs lng, lat and zoom', () => {
  expect(readViewParams({ lng: '2.5', lat: '47', zoom: '9' })).toEqual({ center: [2.5, 47], zoom: 9 })
  expect(readViewParams({ lng: '2.5', lat: '47' })).toBeUndefined()
  expect(readViewParams({ lng: 'x', lat: '47', zoom: '9' })).toBeUndefined()
})

test('the deprecated names of a shared view are still read', () => {
  expect(readViewParams({ lon: '2.5', lat: '47', zoom: '9' })).toEqual({ center: [2.5, 47], zoom: 9 })
  expect(readViewParams({ _c_map_center: '2.5,47', _c_map_zoom: '9' })).toEqual({ center: [2.5, 47], zoom: 9 })
})

test('writing a view uses the new names only', () => {
  const params: Record<string, string | undefined> = { lon: '1', _c_map_center: '1,2', _c_map_zoom: '3', other: 'kept' }
  writeViewParams(params, { lng: 2.123456, lat: 47.654321 }, 9.876)
  expect(params).toEqual({ lng: '2.12346', lat: '47.65432', zoom: '9.88', other: 'kept' })
})

test('the initial view: shared link, then configured position, then an extent', () => {
  const dataBounds = [1, 43, 4, 45]
  expect(resolveInitialView({ params: { lng: '5', lat: '45', zoom: '12' }, center: [2, 46], zoom: 6, dataBounds }))
    .toEqual({ center: [5, 45], zoom: 12 })
  expect(resolveInitialView({ params: { lng: '5' }, center: [2, 46], zoom: 6, dataBounds })).toEqual({ center: [2, 46], zoom: 6 })
  expect(resolveInitialView({ dataBounds })).toEqual({ bounds: dataBounds })
  expect(resolveInitialView({ bounds: [0, 42, 8, 51], dataBounds })).toEqual({ bounds: [0, 42, 8, 51] })
  expect(resolveInitialView({})).toEqual({ bounds: franceBounds })
  expect(resolveInitialView({ dataBounds: [1, 45, 4, 43] })).toEqual({ bounds: franceBounds })
})

test('the data filtered by the parent page come after a shared link, before the configured position', () => {
  const filteredBounds = [5.3, 43.2, 5.4, 43.3]
  expect(resolveInitialView({ params: { lng: '5', lat: '45', zoom: '12' }, filteredBounds, center: [2, 46], zoom: 6 }))
    .toEqual({ center: [5, 45], zoom: 12 })
  expect(resolveInitialView({ filteredBounds, center: [2, 46], zoom: 6, dataBounds: [1, 43, 4, 45] })).toEqual({ bounds: filteredBounds })
  expect(resolveInitialView({ filteredBounds: null, center: [2, 46], zoom: 6 })).toEqual({ center: [2, 46], zoom: 6 })
  // a single point: data-fair gives a flat extent, framed with the app's maxZoom
  expect(resolveInitialView({ filteredBounds: [5.3, 43.2, 5.3, 43.2], center: [2, 46], zoom: 6 })).toEqual({ bounds: [5.3, 43.2, 5.3, 43.2] })
})

test('a partial configured position is completed by the extent', () => {
  const dataBounds = [1, 43, 4, 45]
  expect(resolveInitialView({ center: [2, 46], dataBounds })).toEqual({ bounds: dataBounds, center: [2, 46] })
  expect(resolveInitialView({ zoom: 7, dataBounds })).toEqual({ bounds: dataBounds, zoom: 7 })
  expect(resolveInitialView({ center: [2, 46] })).toEqual({ bounds: franceBounds, center: [2, 46] })
})
