import { expect, it } from 'vitest'
import { queryKeys } from './index'

it('namespaces query keys', () => {
  expect(queryKeys.all).toEqual(['potluck'])
})
