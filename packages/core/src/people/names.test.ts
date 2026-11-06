import { describe, expect, it } from 'vitest'
import { firstName } from '../index'

describe('firstName', () => {
  it('takes the first word of a display name', () => {
    expect(firstName('Ava Chen')).toBe('Ava')
    expect(firstName('  Ben   Ortiz ')).toBe('Ben')
    expect(firstName('Cleo')).toBe('Cleo')
    expect(firstName('')).toBe('')
  })
})
