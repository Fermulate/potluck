/**
 * The people the viewer blocked who would end up on this expense with them, so the form can say
 * so before saving. It mirrors `private.blocked_pair(people, fresh)`: a block between two people
 * on the expense (payers or shares) refuses it when either of them is new to it; on a new expense
 * (`before` null) everyone is new. Only the viewer's own blocks (`my_blocks`) are known here, so
 * only the person who blocked is told by name; anyone else hears the server's neutral refusal.
 */
export function blockedOnExpense(
  viewerId: string,
  people: readonly string[],
  before: readonly string[] | null,
  blocked: ReadonlySet<string>,
): string[] {
  const on = new Set(people)
  if (!on.has(viewerId) || blocked.size === 0) return []
  const isNew = (id: string) => before === null || !before.includes(id)
  return [...on].filter(
    (id) => id !== viewerId && blocked.has(id) && (isNew(id) || isNew(viewerId)),
  )
}
