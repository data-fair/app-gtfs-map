import { test, expect } from '@playwright/test'
import schema from '../../public/config-schema.json' with { type: 'json' }
import { basemaps } from '../../src/utils/map-styles'

interface Choice { const?: unknown, title?: string }
interface SchemaNode { oneOf?: Choice[], default?: unknown }

// every basemap choice of the schema, wherever it is declared (a property or array items)
const basemapChoices: SchemaNode[] = []
const walk = (node: unknown) => {
  if (Array.isArray(node)) return node.forEach(walk)
  if (!node || typeof node !== 'object') return
  const { oneOf } = node as SchemaNode
  if (Array.isArray(oneOf) && oneOf.some(choice => choice.const === 'klokantech-basic')) basemapChoices.push(node as SchemaNode)
  Object.values(node).forEach(walk)
}
walk(schema)

test('the configuration schema offers exactly the shared basemaps', () => {
  expect(basemapChoices.length).toBeGreaterThan(0)
  for (const node of basemapChoices) {
    expect(node.oneOf!.map(choice => ({ id: choice.const, title: choice.title })))
      .toEqual(basemaps.map(({ id, title }) => ({ id, title })))
    if (node.default !== undefined) expect(basemaps.map(b => b.id)).toContain(node.default)
  }
})
