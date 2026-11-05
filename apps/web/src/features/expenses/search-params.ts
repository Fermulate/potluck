const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A uuid from a search param, or undefined for anything else. */
export function uuidParam(value: unknown): string | undefined {
  return typeof value === 'string' && UUID.test(value) ? value : undefined
}

export interface NewExpenseSearch {
  groupId?: string
  eventId?: string
}

export function validateNewExpenseSearch(search: Record<string, unknown>): NewExpenseSearch {
  return { groupId: uuidParam(search.groupId), eventId: uuidParam(search.eventId) }
}

export interface SettleSearch {
  groupId?: string
  to?: string
  /** Minor units. */
  amount?: number
}

export function validateSettleSearch(search: Record<string, unknown>): SettleSearch {
  const raw = typeof search.amount === 'string' ? Number(search.amount) : search.amount
  return {
    groupId: uuidParam(search.groupId),
    to: uuidParam(search.to),
    amount: typeof raw === 'number' && Number.isSafeInteger(raw) && raw > 0 ? raw : undefined,
  }
}
