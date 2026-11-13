// Deletes receipt files that no expense uses any more (saves that never finished, files removed
// by someone the bucket would not let delete them). Called daily by pg_cron through the
// `invoke_edge_function` hook with the shared secret; deletes go through the Storage API so the
// stored objects go too (ADR 21, docs/receipts.md).
import { adminClient } from '../_shared/admin.ts'
import { hasEdgeSecret, json } from '../_shared/http.ts'
import { sweepOrphans } from './sweep.ts'

Deno.serve(async (req) => {
  // pg_net posts; nothing else should ever reach this.
  if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405)
  if (!hasEdgeSecret(req)) return json({ error: 'forbidden' }, 403)
  const admin = adminClient()
  try {
    const result = await sweepOrphans({
      rpc: (fn, args) => admin.rpc(fn, args),
      remove: (paths) => admin.storage.from('receipts').remove(paths),
    })
    return json(result)
  } catch (error) {
    return json({ error: String((error as { message?: string })?.message ?? error) }, 500)
  }
})
