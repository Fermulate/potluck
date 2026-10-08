import { describe, expect, it } from 'vitest'
import { heatLevel, heatLevels } from '../index'

describe('heatLevels', () => {
  it('maps counts onto 0..4 relative to the max', () => {
    expect(heatLevels([0, 1, 2, 3, 4], 4)).toEqual([0, 1, 2, 3, 4])
    expect(heatLevels([0, 1, 2, 3, 5, 7, 8, 10], 10)).toEqual([0, 1, 1, 2, 2, 3, 4, 4])
  })

  it('shows any availability as at least level 1', () => {
    expect(heatLevels([1], 100)).toEqual([1])
  })

  it('reaches the top level with only a couple of people', () => {
    expect(heatLevels([0, 1, 2], 2)).toEqual([0, 2, 4])
  })

  it('clamps out of range counts and handles an empty group', () => {
    expect(heatLevels([12, -1], 10)).toEqual([4, 0])
    expect(heatLevels([0, 3], 0)).toEqual([0, 0])
  })

  it('exposes a single cell helper', () => {
    expect(heatLevel(3, 4)).toBe(3)
  })
})
