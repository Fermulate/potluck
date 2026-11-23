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

/**
 * Native share sheet where there is one, clipboard otherwise (then a toast saying `copied`).
 * Closing the sheet without sharing is not an error.
 */
export async function shareLink(
  data: { title: string; text: string; url: string },
  copied: string,
) {
  if (typeof navigator.share === 'function' && (!navigator.canShare || navigator.canShare(data))) {
    try {
      await navigator.share(data)
      return
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return
    }
  }
  if (await copyText(data.url)) toast.success(copied)
}

export async function shareInvite(groupName: string, code: string) {
  const url = inviteUrl(code)
  await shareLink(
    {
      title: t('invites.shareTitle', { group: groupName }),
      text: t('invites.shareText', { group: groupName, url }),
      url,
    },
    t('invites.linkCopied'),
  )
}
