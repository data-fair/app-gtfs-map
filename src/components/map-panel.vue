<template>
  <!-- one tree for every layout: the map in the default slot is never remounted across breakpoints -->
  <v-layout
    ref="layoutEl"
    class="h-100"
  >
    <v-navigation-drawer
      v-if="layout !== 'sheet' && mainSections().length"
      id="map-panel-drawer"
      v-model="drawer"
      :location="location"
      :permanent="layout === 'panel'"
      :temporary="layout === 'overlay'"
      :mobile="false"
      :scrim="false"
      :width="panelWidth"
      :border="layout === 'overlay' ? '0' : undefined"
    >
      <!-- a section alone (the legend, with the selection in its own drawer) is no toggle: a plain
           header like the selection drawer's (same height as with its close button), then its content -->
      <template v-if="lone()">
        <template
          v-for="section in mainSections()"
          :key="section"
        >
          <v-list-item
            :prepend-icon="icons[section]"
            :title="sectionTitle(section)"
            prepend-gap="8"
            min-height="52"
            class="px-3 py-2"
          />
          <v-progress-linear
            :active="!!loading[section]"
            indeterminate
            color="primary"
          />
          <div class="px-3 pb-4 pt-2">
            <p
              v-if="isEmpty(section)"
              class="text-body-medium text-medium-emphasis"
            >
              {{ t('emptySelection') }}
            </p>
            <slot
              v-else
              :name="section"
            />
          </div>
        </template>
      </template>
      <v-expansion-panels
        v-else
        v-model="panels"
        class="map-panel-sections"
        variant="accordion"
        multiple
        static
        flat
      >
        <v-expansion-panel
          v-for="section in mainSections()"
          :key="section"
          :ref="(el) => { if (section === 'selection') selectionPanel = el as ComponentPublicInstance | null }"
          :value="section"
        >
          <!-- the section button inside a heading (WAI-ARIA accordion pattern): screen readers can jump between sections -->
          <h2 class="map-panel-heading">
            <v-expansion-panel-title
              :title="t(panels.includes(section) ? 'collapse' : 'expand', { section: sectionTitle(section) })"
              class="px-3"
            >
              <v-icon
                :icon="icons[section]"
                start
              />
              {{ sectionTitle(section) }}
            </v-expansion-panel-title>
          </h2>
          <v-progress-linear
            :active="!!loading[section] && panels.includes(section)"
            indeterminate
            color="primary"
          />
          <v-expansion-panel-text>
            <p
              v-if="isEmpty(section)"
              class="text-body-medium text-medium-emphasis"
            >
              {{ t('emptySelection') }}
            </p>
            <slot
              v-else
              :name="section"
            />
          </v-expansion-panel-text>
        </v-expansion-panel>
      </v-expansion-panels>
    </v-navigation-drawer>
    <!-- opt-in (detailsAside), xl: the selection in its own drawer, opposite to the panel; it pushes the map -->
    <v-navigation-drawer
      v-if="aside && slots.selection"
      :model-value="!!selected"
      :location="location === 'right' ? 'left' : 'right'"
      :width="detailsWidth"
      :mobile="false"
      permanent
    >
      <template #prepend>
        <v-list-item
          :prepend-icon="icons.selection"
          :title="sectionTitle('selection')"
          prepend-gap="8"
          class="pl-3 pr-2 py-2"
        >
          <template #append>
            <v-btn
              :icon="mdiClose"
              :aria-label="t('closeDetails')"
              :title="t('closeDetails')"
              density="comfortable"
              variant="text"
              @click="emit('deselect')"
            />
          </template>
        </v-list-item>
        <v-progress-linear
          :active="!!loading.selection"
          indeterminate
          color="primary"
        />
      </template>
      <!-- a deselection keeps the last content in place (its leave transition) while the drawer slides out -->
      <v-fade-transition>
        <div
          v-if="selected"
          class="px-3 pb-4 pt-2"
        >
          <slot name="selection" />
        </div>
      </v-fade-transition>
    </v-navigation-drawer>
    <v-main
      tag="div"
      class="h-100"
    >
      <div class="d-flex flex-column h-100">
        <!-- map-panel-cover: the part of the map under the drawer, cleared by the maplibre controls (map-controls.css) -->
        <div
          ref="boxEl"
          class="flex-grow-1 position-relative overflow-hidden"
          :style="{ '--map-panel-cover': `${cover[location]}px`, '--map-panel-cover-left': `${cover.left}px`, '--map-panel-cover-right': `${cover.right}px` }"
        >
          <slot
            v-if="sized"
            :controls="controls"
            :cover="cover"
          />
          <!-- a tab growing out of the drawer, inside the map box (never out of an iframe), under the
               controls of that side: same surface and elevation, no shadow at the junction, rounded on the map side -->
          <div
            v-if="(layout === 'overlay' || layout === 'docked') && sections().length && !thumbnail"
            :class="['map-panel-tab position-absolute bg-surface elevation-4', `map-panel-tab--${location}`, location === 'right' ? 'rounded-s-lg' : 'rounded-e-lg']"
            :style="{ [location]: `${cover[location]}px`, top: `${tabTop}px` }"
          >
            <v-btn
              :aria-label="drawer ? t('close') : t('open')"
              :aria-expanded="drawer"
              aria-controls="map-panel-drawer"
              :rounded="location === 'right' ? '0 s-lg' : '0 e-lg'"
              width="36"
              height="80"
              min-width="0"
              variant="text"
              class="px-0"
              @click="drawer = !drawer"
            >
              <v-icon
                :icon="(location === 'right') === drawer ? mdiChevronRight : mdiChevronLeft"
                size="32"
              />
            </v-btn>
          </div>
        </div>
        <!-- the map keeps the height above the folded sheet: its controls stay in place and the
             unfolded sheet grows over them; rounded top overlapping the map by the radius -->
        <div
          v-if="layout === 'sheet' && sections().length"
          class="flex-shrink-0 position-relative mt-n2"
          :style="{ height: `${headerHeight}px` }"
        >
          <v-sheet
            rounded="t-lg"
            elevation="5"
            class="map-panel-sheet position-absolute bottom-0 left-0 right-0"
          >
            <div ref="headerEl">
              <!-- the drag zone: no click action, the chevrons are the explicit (and keyboard) way;
                   fixed 40 px height: a control size (like the 80 x 36 tab), not content -->
              <div
                class="map-panel-handle position-relative d-flex justify-center align-center"
                style="height: 40px"
                @pointerdown="onHandleDown"
                @pointermove="onHandleMove"
                @pointerup="onHandleUp"
                @pointercancel="onHandleUp"
              >
                <v-sheet
                  width="32"
                  height="4"
                  rounded="pill"
                  color="rgb(var(--v-theme-on-surface))"
                  class="opacity-40"
                  aria-hidden="true"
                />
                <div class="position-absolute right-0 d-flex">
                  <v-btn
                    v-if="shownDetent !== activeDetents.at(-1)"
                    :icon="mdiChevronUp"
                    :aria-label="t('raise')"
                    :aria-expanded="shownDetent !== 'folded'"
                    aria-controls="map-panel-sheet"
                    density="comfortable"
                    variant="text"
                    @pointerdown.stop
                    @click="step(1)"
                  />
                  <v-btn
                    v-if="detent !== 'folded'"
                    :icon="mdiChevronDown"
                    :aria-label="t('lower')"
                    :aria-expanded="true"
                    aria-controls="map-panel-sheet"
                    density="comfortable"
                    variant="text"
                    @pointerdown.stop
                    @click="step(-1)"
                  />
                </div>
              </div>
              <v-tabs
                :model-value="activeTab"
                :mandatory="false"
                :scroll-to-active="false"
                density="compact"
                grow
                @update:model-value="() => {}"
              >
                <!-- an empty Selection has no tab on a phone: it appears with the selection -->
                <v-tab
                  v-for="section in visibleSections()"
                  :key="section"
                  :value="section"
                  :prepend-icon="icons[section]"
                  :text="sectionTitle(section)"
                  @click="onTabClick(section)"
                />
              </v-tabs>
              <v-progress-linear
                :active="detent !== 'folded' && !!tab && !!loading[tab]"
                indeterminate
                color="primary"
              />
            </div>
            <!-- folded: hidden but still laid out, so the content height is known before unfolding -->
            <v-sheet
              id="map-panel-sheet"
              ref="contentEl"
              :max-height="contentMax"
              :inert="contentMax === 0"
              :style="contentMax === 0 ? { visibility: 'hidden' } : undefined"
              class="overflow-y-auto"
            >
              <v-tabs-window
                ref="windowEl"
                v-model="tab"
              >
                <v-tabs-window-item
                  v-for="section in sections()"
                  :key="section"
                  :value="section"
                  class="pa-3"
                >
                  <slot :name="section" />
                </v-tabs-window-item>
              </v-tabs-window>
            </v-sheet>
          </v-sheet>
        </div>
      </div>
    </v-main>
  </v-layout>
</template>

<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue'
import { computed, onBeforeUnmount, onBeforeUpdate, onMounted, ref, shallowRef, useSlots, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useElementSize, useMutationObserver } from '@vueuse/core'
import { mdiChevronDown, mdiChevronLeft, mdiChevronRight, mdiChevronUp, mdiClose, mdiMagnify, mdiMapLegend, mdiSelectionMarker } from '@mdi/js'
import { useDisplay } from 'vuetify'
import reactiveSearchParams from '@data-fair/lib-vue/reactive-search-params-global.js'
import { useMapLayout } from '../composables/use-map-layout'

type Section = 'search' | 'legend' | 'selection'
type Detent = 'folded' | 'half' | 'full'

const props = withDefaults(defineProps<{
  // the selected object or its id: every new value opens the panel on the Selection section
  selected?: unknown
  location?: 'left' | 'right'
  // the next width step, for an existing option such as largePanel
  large?: boolean
  // opt-in: from xl, the selection in a drawer of its own instead of a section of the panel (explore only,
  // for compatibility with its former details panel); every other app keeps the Selection in the panel
  detailsAside?: boolean
  // the next width step of that drawer (explore's detailsPanelWidth)
  largeDetails?: boolean
  titles?: Partial<Record<Section, string>>
  // a loading bar right under the section title
  loading?: Partial<Record<Section, boolean>>
}>(), { location: 'right', large: false, detailsAside: false, largeDetails: false, loading: () => ({}) })

// Escape or the close button of the selection drawer, while something is selected; the app clears its selection
const emit = defineEmits<{ deselect: [] }>()

const { t } = useI18n()
const slots = useSlots()
const layout = useMapLayout()
// the gallery thumbnail is a still image: no action button, the tab included
const thumbnail = reactiveSearchParams.thumbnail === 'true'
const { name, xlAndUp } = useDisplay()

// [normal, large] per breakpoint, the same in every app; at sm the drawer overlays the map,
// so it leaves the map at least half of a 600 px screen (large aside), wide enough for form labels
const widths: Record<string, [number, number]> = { sm: [280, 320], md: [320, 400], lg: [360, 440] }
const widthStep = (large: boolean) => (widths[name.value] ?? [400, 520])[large ? 1 : 0]
const panelWidth = computed(() => widthStep(props.large))
const detailsWidth = computed(() => widthStep(props.largeDetails))
// with detailsAside, from xl (the panel is permanent there), the selection leaves the panel for a drawer
// of its own, shown only while something is selected
const aside = computed(() => props.detailsAside && xlAndUp.value)

const order: Section[] = ['search', 'selection', 'legend']
const icons: Record<Section, string> = { search: mdiMagnify, legend: mdiMapLegend, selection: mdiSelectionMarker }
const sections = () => order.filter(section => slots[section])
const sectionTitle = (section: Section) => props.titles?.[section] ?? t(section)
// an empty Selection stays in the drawer, its content says how to select; the bottom sheet has no tab for it
const isEmpty = (section: Section) => section === 'selection' && !props.selected
const visibleSections = () => sections().filter(section => !isEmpty(section))
const mainSections = () => aside.value ? sections().filter(section => section !== 'selection') : sections()
// a section alone in the panel is shown open, without a toggle
const lone = () => mainSections().length === 1

// maplibre controls go on the side of the panel, along its edge (--map-panel-cover-*, map-controls.css)
const controls = computed<'left' | 'right'>(() => props.location)
const drawer = ref(false)
// the sheet opens on the first section with content
const tab = ref<Section | undefined>(visibleSections()[0] ?? sections()[0])
const detent = ref<Detent>('folded')
// controlled by onTabClick only (the no-op update handler keeps Vuetify from selecting on its own);
// no tab looks active while the sheet is folded
const activeTab = computed(() => detent.value !== 'folded' ? tab.value : undefined)
const panels = ref<Section[]>(sections().filter(section => section !== 'selection'))
const selectionPanel = shallowRef<ComponentPublicInstance | null>(null)

// a section whose slot appears after mount (configuration changed in draft, data loaded) opens
// like the ones present at mount; an app with nothing to select passes no selection slot at all
let known = sections()
onBeforeUpdate(() => {
  const now = sections()
  for (const section of now) {
    if (section !== 'selection' && !known.includes(section) && !panels.value.includes(section)) panels.value.push(section)
  }
  if (!tab.value || !visibleSections().includes(tab.value)) tab.value = visibleSections()[0] ?? now[0]
  known = now
})

// Escape deselects, unless typed in a field (the address search closes its own list)
function onKeydown (event: KeyboardEvent) {
  if (event.key !== 'Escape' || !props.selected) return
  const target = event.target as HTMLElement | null
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return
  emit('deselect')
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => document.removeEventListener('keydown', onKeydown))

watch(layout, value => { drawer.value = value === 'panel' || value === 'docked' }, { immediate: true })

// brings the opened Selection into view when the drawer is scrolled
function scrollToSelection () {
  const el = selectionPanel.value?.$el as HTMLElement | undefined
  const container = el?.closest('.v-navigation-drawer__content')
  if (!el || !container) return
  container.scrollBy({ top: el.getBoundingClientRect().top - container.getBoundingClientRect().top, behavior: 'smooth' })
}

function onTabClick (section: Section) {
  tab.value = section
  if (detent.value === 'folded') detent.value = 'half'
}

// sheet detents, as content heights: half leaves half of the app to the map, full a strip of it;
// a content that fits in half a screen only folds and unfolds (half, at its own height)
const layoutEl = ref<ComponentPublicInstance | null>(null)
const headerEl = ref<HTMLElement | null>(null)
const contentEl = ref<ComponentPublicInstance | null>(null)
const windowEl = ref<ComponentPublicInstance | null>(null)
const { height: layoutHeight } = useElementSize(layoutEl)
const { height: headerHeight } = useElementSize(headerEl, undefined, { box: 'border-box' })
const { height: naturalHeight } = useElementSize(windowEl)
// the map waits for the final size of its box (once): an embedding d-frame first lays the app out
// wider and 0 px high, and a map created then keeps that framing and an unfolded credit
const sized = ref(false)
watch(() => layoutHeight.value > 0 && (layout.value !== 'sheet' || !sections().length || headerHeight.value > 0), ok => {
  if (ok) sized.value = true
}, { immediate: true })
const maxHeight = (d: Detent) => d === 'folded' ? 0 : Math.max(0, layoutHeight.value * (d === 'half' ? 0.5 : 0.85) - headerHeight.value)
const detentHeight = (d: Detent) => Math.min(maxHeight(d), naturalHeight.value)
const activeDetents = computed<Detent[]>(() => naturalHeight.value > maxHeight('half') ? ['folded', 'half', 'full'] : ['folded', 'half'])
// full on a short content (another tab, or one still loading or not measured yet) is shown as half,
// the same height, and comes back with a longer content: no detent is chosen on an unmeasured height
const shownDetent = computed<Detent>(() => activeDetents.value.includes(detent.value) ? detent.value : 'half')
const dragHeight = ref<number | null>(null)
const contentMax = computed(() => dragHeight.value ?? maxHeight(shownDetent.value))

// the part of the map under the drawer that overlays it (600 to 1144 px) or under the unfolded sheet
// (at its detent, not while dragged), a padding for the app's fits
const cover = computed(() => {
  const width = layout.value === 'overlay' && drawer.value ? panelWidth.value : 0
  const bottom = layout.value === 'sheet' && detent.value !== 'folded' ? detentHeight(shownDetent.value) : 0
  return { top: 0, bottom, left: props.location === 'left' ? width : 0, right: props.location === 'right' ? width : 0 }
})

// the tab goes under the maplibre controls at the top of its side, whatever their number
const boxEl = ref<HTMLElement | null>(null)
const topControls = shallowRef<HTMLElement | null>(null)
const findTopControls = () => {
  const selector = `.maplibregl-ctrl-top-${controls.value}`
  if (!topControls.value?.isConnected || !topControls.value.matches(selector)) topControls.value = boxEl.value?.querySelector<HTMLElement>(selector) ?? null
}
useMutationObserver(boxEl, findTopControls, { childList: true, subtree: true })
watch(controls, findTopControls)
const { height: topControlsHeight } = useElementSize(topControls, undefined, { box: 'border-box' })
const tabTop = computed(() => Math.max(64, topControlsHeight.value + 12))

function step (direction: 1 | -1) {
  const list = activeDetents.value
  detent.value = list[Math.min(list.length - 1, Math.max(0, list.indexOf(shownDetent.value) + direction))]
}

// an initial selection (shared link) opens the sheet at once
watch(() => props.selected, selected => {
  if (selected) {
    drawer.value = true
    tab.value = 'selection'
    if (detent.value === 'folded') detent.value = 'half'
    if (!panels.value.includes('selection')) panels.value.push('selection')
    // after the expand transition (about 250 ms), once the drawer can scroll that far
    setTimeout(scrollToSelection, 300)
  } else {
    // the deselected Selection stays open on its hint: closing it would show the hint during the collapse
    if (tab.value === 'selection') tab.value = visibleSections()[0]
  }
}, { immediate: true })

// vertical drag on the handle only (touch-action: none there): the map and the content keep
// their own gestures; on release, the nearest detent, or the next one for a short flick
let dragStartY = 0
let dragStartHeight = 0
function onHandleDown (event: PointerEvent) {
  dragStartY = event.clientY
  dragStartHeight = detent.value === 'folded' ? 0 : ((contentEl.value?.$el as HTMLElement | undefined)?.offsetHeight ?? 0)
  dragHeight.value = dragStartHeight
  ;(event.currentTarget as HTMLElement).setPointerCapture(event.pointerId)
}
function onHandleMove (event: PointerEvent) {
  if (dragHeight.value === null) return
  dragHeight.value = Math.min(detentHeight('full'), Math.max(0, dragStartHeight + dragStartY - event.clientY))
}
function onHandleUp (event: PointerEvent) {
  if (dragHeight.value === null) return
  const delta = dragStartY - event.clientY
  const height = dragHeight.value
  dragHeight.value = null
  const nearest = activeDetents.value.reduce((a, b) => Math.abs(detentHeight(b) - height) < Math.abs(detentHeight(a) - height) ? b : a)
  if (nearest !== shownDetent.value || Math.abs(delta) < 24) detent.value = nearest
  else step(delta > 0 ? 1 : -1)
}
</script>

<style scoped>
/* no padding prop on v-expansion-panel-text (nor a local SASS settings file, they come from
   lib-vuetify): the same 12 px gutter as the bottom sheet (pa-3) and the section titles (px-3) */
.map-panel-sections :deep(.v-expansion-panel-text__wrapper) {
  padding-inline: 12px;
}
/* the heading only carries the semantics: the section button keeps its own look */
.map-panel-heading {
  font: inherit;
  margin: 0;
}
/* no Vuetify equivalent: the handle takes vertical drags instead of scrolling the page */
.map-panel-handle {
  touch-action: none;
}
/* no z-index utility in Vuetify: the unfolded sheet covers the maplibre controls (z-index 2) */
.map-panel-sheet {
  z-index: 3;
}
/* the tab follows the drawer, with the drawer's own transition; above the drawer (904)
   so it covers the drawer's shadow at the junction, its own shadow clipped on the junction side */
.map-panel-tab {
  z-index: 905;
  transition: left 0.2s cubic-bezier(0.4, 0, 0.2, 1), right 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.map-panel-tab--right {
  clip-path: inset(-24px 0 -24px -24px);
}
.map-panel-tab--left {
  clip-path: inset(-24px -24px -24px 0);
}
</style>

<i18n lang="yaml">
fr:
  search: Recherche
  legend: Légende
  selection: Sélection
  emptySelection: Cliquez sur un élément de la carte pour afficher ses informations.
  open: Ouvrir le panneau
  close: Fermer le panneau
  closeDetails: Fermer la fiche
  collapse: Replier « {section} »
  expand: Déplier « {section} »
  raise: Lever le panneau
  lower: Baisser le panneau
en:
  search: Search
  legend: Legend
  selection: Selection
  emptySelection: Click an item on the map to show its details.
  open: Open the panel
  close: Close the panel
  closeDetails: Close the details
  collapse: Collapse "{section}"
  expand: Expand "{section}"
  raise: Raise the panel
  lower: Lower the panel
</i18n>
