import { linkMemory, storedRecord } from '@/lib/link-memory'

/** What a guest's browser remembers per link: its answer token and the name they typed. */
export interface GuestMemory {
  token: string
  name: string
}

export const guestMemory = linkMemory<GuestMemory>('potluck.guest', (stored) => {
  const value = storedRecord(stored)
  return typeof value.token === 'string' && value.token
    ? { token: value.token, name: typeof value.name === 'string' ? value.name : '' }
    : null
})
