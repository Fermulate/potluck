// Recovery with a saved code. No Deno APIs, so the tests run under Node too.

export interface RecoverDeps {
  /** True when `code` is one of the user's unused recovery codes. */
  matches: (userId: string, code: string) => Promise<boolean>
  /** Ids of every second factor on the account, verified or not. */
  factorIds: (userId: string) => Promise<string[]>
  deleteFactor: (userId: string, factorId: string) => Promise<void>
  /** Drops every recovery code of the user. */
  forgetCodes: (userId: string) => Promise<void>
}

export type RecoverResult =
  | { ok: true; removed: number }
  | { ok: false; status: 400 | 500; error: 'invalid_recovery_code' | 'recovery_failed' }

/** Codes are 10 symbols; anything far off that is refused before touching the database. */
export function plausibleCode(code: unknown): code is string {
  if (typeof code !== 'string') return false
  const symbols = code.replace(/[^A-Za-z0-9]/g, '')
  return symbols.length === 10 && code.length <= 32
}

/**
 * Checks the code, removes every second factor, then forgets the codes. The codes go last, so
 * a failure half way leaves the person able to try again with the same code.
 */
export async function recover(
  userId: string,
  code: unknown,
  deps: RecoverDeps,
): Promise<RecoverResult> {
  if (!plausibleCode(code) || !(await deps.matches(userId, code))) {
    return { ok: false, status: 400, error: 'invalid_recovery_code' }
  }
  try {
    const ids = await deps.factorIds(userId)
    for (const id of ids) await deps.deleteFactor(userId, id)
    await deps.forgetCodes(userId)
    return { ok: true, removed: ids.length }
  } catch {
    return { ok: false, status: 500, error: 'recovery_failed' }
  }
}
