import type { AttributionControlOptions } from 'maplibre-gl'
import { AttributionControl } from 'maplibre-gl'

// maplibre unfolds the compact credit as soon as it gets content: on a phone (map narrower than
// 600 px) it stays folded instead, and its « i » button still unfolds it; until that button is used,
// the fold follows the map size (an embed is first laid out at another size than its final one)
export class FoldedAttributionControl extends AttributionControl {
  constructor (options?: AttributionControlOptions) {
    super(options)
    let touched = false
    const toggle = this._toggleAttribution
    this._toggleAttribution = () => {
      touched = true
      toggle()
    }
    const update = this._updateCompact
    this._updateCompact = () => {
      update()
      if (touched || !this._container.classList.contains('maplibregl-compact')) return
      this._container.classList.toggle('maplibregl-compact-show', this._map.getCanvasContainer().offsetWidth >= 600)
    }
  }
}
