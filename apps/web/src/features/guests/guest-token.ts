import { linkMemory, parseTokenMemory, type TokenMemory } from '@/lib/link-memory'

/** What a guest's browser remembers per link: its answer token and the name they typed. */
export type GuestMemory = TokenMemory

export const guestMemory = linkMemory('potluck.guest', parseTokenMemory)
