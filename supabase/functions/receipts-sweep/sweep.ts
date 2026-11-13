// The receipts sweep without Deno: list orphaned files, delete them in batches. Tested by
// `pnpm test:functions` with a stand-in client.

export interface SweepClient {
  rpc(
    fn: 'orphan_receipts',
    args: { max_count: number },
  ): PromiseLike<{ data: string[] | null; error: unknown }>
  remove(paths: string[]): PromiseLike<{ error: unknown }>
}

/** Storage deletes at most this many objects per call. */
export const BATCH = 100

/**
 * Deletes receipt files no expense points at (the database decides which: older than a day,
 * not a receipt, not an attachment). Returns how many went; a failed batch is reported and the
 * next run tries again.
 */
export async function sweepOrphans(
  client: SweepClient,
  maxCount = 500,
): Promise<{ removed: number; failed: number }> {
  const { data, error } = await client.rpc('orphan_receipts', { max_count: maxCount })
  if (error) throw error
  const paths = data ?? []
  let removed = 0
  let failed = 0
  for (let i = 0; i < paths.length; i += BATCH) {
    const batch = paths.slice(i, i + BATCH)
    const result = await client.remove(batch)
    if (result.error) failed += batch.length
    else removed += batch.length
  }
  return { removed, failed }
}
