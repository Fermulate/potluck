import { expect, it } from 'vitest'
import { avatarUrl, createSupabaseClient, queryKeys } from './index'

it('namespaces query keys', () => {
  expect(queryKeys.all).toEqual(['potluck'])
})

it('creates a client bound to the project URL', () => {
  const client = createSupabaseClient('https://demo.supabase.co', 'sb_publishable_test')
  expect(avatarUrl(client, 'u1/a.jpg')).toBe(
    'https://demo.supabase.co/storage/v1/object/public/avatars/u1/a.jpg',
  )
})
