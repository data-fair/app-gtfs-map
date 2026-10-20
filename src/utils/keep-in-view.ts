import type { LngLat, Map, PaddingOptions } from 'maplibre-gl'

// room left around the clicked element, in pixels
const MARGIN = 40

type Padding = Record<'top' | 'bottom' | 'left' | 'right', number>

// a padding plus the part of the map covered by a panel (`cover` of map-panel.vue), for fitBounds and the like
export function withCover (padding: number | Partial<PaddingOptions> = 0, cover?: Partial<PaddingOptions>): Padding {
  const p = typeof padding === 'number' ? { top: padding, bottom: padding, left: padding, right: padding } : padding
  const side = (key: keyof Padding) => (p[key] ?? 0) + (cover?.[key] ?? 0)
  return { top: side('top'), bottom: side('bottom'), left: side('left'), right: side('right') }
}

// While something is selected, the clicked element stays in the visible part of the map: a drawer that
// shrinks the map (resize) or covers part of it (check() when the cover changes) pans it back, at the
// same zoom, once a running camera move (a fit on the selection) is over
export function keepInView (map: Map, options: { selected: () => boolean, cover?: () => Partial<PaddingOptions> | undefined }) {
  let at: LngLat | null = null
  let timer: ReturnType<typeof setTimeout> | undefined

  function run () {
    if (!options.selected()) at = null
    if (!at) return
    if (map.isMoving()) {
      map.once('moveend', check)
      return
    }
    const { top, bottom, left, right } = withCover(MARGIN, options.cover?.())
    const { x, y } = map.project(at)
    const { clientWidth: width, clientHeight: height } = map.getContainer()
    const dx = x < left ? x - left : x > width - right ? x - width + right : 0
    const dy = y < top ? y - top : y > height - bottom ? y - height + bottom : 0
    if (dx || dy) map.panBy([dx, dy])
  }

  function check () {
    clearTimeout(timer)
    timer = setTimeout(run, 100)
  }

  map.on('click', (e) => { at = e.lngLat })
  map.on('resize', check)
  map.on('remove', () => clearTimeout(timer))
  return { check }
}
