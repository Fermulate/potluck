import { expect, it } from 'vitest'
import { cn } from './cn'

it('merges conflicting tailwind classes', () => {
  expect(cn('px-2', false, 'px-4')).toBe('px-4')
})
