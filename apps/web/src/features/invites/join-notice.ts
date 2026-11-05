import { invitePreviewQueryOptions } from '@potluck/api'
import { t } from '@potluck/i18n'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'

/** The invite code inside a `/join/<code>` path, if that is where auth will return to. */
export function inviteCodeFrom(redirect: string | undefined): string | undefined {
  return redirect?.match(/^\/join\/([A-Za-z0-9_-]{10,64})/)?.[1]
}

/** When auth was reached from an invite, name the group the person is about to join. */
export function useJoinNotice(redirect: string | undefined): string | undefined {
  const code = inviteCodeFrom(redirect)
  const { data } = useQuery({
    ...invitePreviewQueryOptions(supabase, code ?? ''),
    enabled: !!code,
  })
  if (!code || !data || data.status !== 'valid') return undefined
  return t('auth.joinNotice', { group: data.name })
}
