// Whether a pending email change can be called off for this caller. No Deno APIs, so the tests
// run under Node too.

export interface Caller {
  email?: string | null
  new_email?: string | null
  factors?: { status: string }[] | null
}

export type CancelDecision =
  | { ok: true; email: string }
  | { ok: false; status: 400 | 403; error: 'no_email_change' | 'mfa_required' }

/** The `aal` claim of a bearer token, `aal1` when it cannot be read. */
export function tokenAal(authorization: string): string {
  try {
    const payload = authorization.replace(/^Bearer\s+/i, '').split('.')[1] ?? ''
    const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
    const aal = (JSON.parse(json) as { aal?: unknown }).aal
    return typeof aal === 'string' ? aal : 'aal1'
  } catch {
    return 'aal1'
  }
}

/**
 * Cancelling resets the address to the current one. A half finished two-step sign in may not do
 * it (the same rule the database applies, ADR 11), and there must be a change to cancel.
 */
export function decide(user: Caller, aal: string): CancelDecision {
  const twoStep = (user.factors ?? []).some((f) => f.status === 'verified')
  if (twoStep && aal !== 'aal2') return { ok: false, status: 403, error: 'mfa_required' }
  if (!user.email || !user.new_email) return { ok: false, status: 400, error: 'no_email_change' }
  return { ok: true, email: user.email }
}
