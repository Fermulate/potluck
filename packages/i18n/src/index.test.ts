import { expect, it } from 'vitest'
import { t } from './index'

it('looks up a message', () => {
  expect(t('app.name')).toBe('Potluck')
})
