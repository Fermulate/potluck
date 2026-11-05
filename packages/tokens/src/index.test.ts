import { expect, it } from 'vitest'
import { colors } from './index'

it('exposes the brand colors', () => {
  expect(colors.ink).toBe('#1d1a16')
  expect(colors.cream).toBe('#fbf5ea')
})
