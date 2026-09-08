import { expect, test } from '@playwright/test'
import { isDraftMode } from '../../src/composables/config'

test.describe('isDraftMode', () => {
  test('ne reconnaît que draft=true', () => {
    expect(isDraftMode('?draft=true')).toBe(true)
    expect(isDraftMode('?foo=1&draft=true')).toBe(true)
    expect(isDraftMode('?draft=false')).toBe(false)
    expect(isDraftMode('')).toBe(false)
  })
})
