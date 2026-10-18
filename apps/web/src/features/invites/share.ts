import { t } from '@potluck/i18n'
import { toast } from '@potluck/ui'
import { inviteUrl } from '@/lib/app-url'

export async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** Native share sheet where there is one, clipboard otherwise. */
export async function shareInvite(groupName: string, code: string) {
  const url = inviteUrl(code)
  const data = { title: t('invites.shareTitle', { group: groupName }), text: t('invites.shareText', { group: groupName, url }), url }
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share({ title: data.title, url })
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  if (await copyText(url)) toast.success(t('invites.linkCopied'))
}
