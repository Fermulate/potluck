import { describe, expect, it } from 'vitest'
import { splitEvenly } from './index'

describe('splitEvenly', () => {
  it('distributes the remainder so shares sum to the total', () => {
    expect(splitEvenly(1000, 3)).toEqual([334, 333, 333])
  })
})
