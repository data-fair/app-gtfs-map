import type { ComputedRef } from 'vue'
import { computed } from 'vue'
import { useDisplay } from 'vuetify'

// xs: bottom sheet; sm and md: drawer over the map, closed at first; lg: side panel pushing the map,
// open at first and collapsible; xl: permanent side panel
export type MapLayout = 'sheet' | 'overlay' | 'docked' | 'panel'

export function useMapLayout (): ComputedRef<MapLayout> {
  const { xs, mdAndDown, lg } = useDisplay()
  return computed(() => xs.value ? 'sheet' : mdAndDown.value ? 'overlay' : lg.value ? 'docked' : 'panel')
}
