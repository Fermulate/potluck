/**
 * Stand-in for `@/lib/supabase` in component tests: realtime channels and storage URLs work,
 * nothing touches the network. Data comes from the seeded query cache, writes are mocked at
 * the `@potluck/api` function boundary.
 */
const channel = {
  on: () => channel,
  subscribe: () => channel,
}

export const supabase = {
  channel: () => channel,
  removeChannel: async () => 'ok',
  storage: {
    from: () => ({
      getPublicUrl: (path: string) => ({ data: { publicUrl: `https://example.test/${path}` } }),
    }),
  },
}
