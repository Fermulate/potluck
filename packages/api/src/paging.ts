/** PostgREST caps each response at `max_rows` (supabase/config.toml), so long reads go in pages. */
export const PAGE_SIZE = 1000

/**
 * Reads every row by asking for `[from, to]` ranges until a short page comes back. The query
 * must have a total order (end with a unique column) or rows can repeat or go missing between
 * pages. Throws the first page error as is.
 */
export async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1)
    if (error) throw error
    const batch = data ?? []
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}
