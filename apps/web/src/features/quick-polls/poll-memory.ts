import { linkMemory, parseTokenMemory, type TokenMemory } from '@/lib/link-memory'

/**
 * What a browser remembers per quick poll: its token (the creator token for whoever made the
 * poll, else the answer token the browser made, kept before its first save went out) and the
 * name typed. Whether this browser made the poll is not kept here: the preview says so for the
 * token (`isCreator`).
 */
export type PollMemory = TokenMemory

export const pollMemory = linkMemory('potluck.poll', parseTokenMemory)
