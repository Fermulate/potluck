import { t } from '@potluck/i18n'
import { shareLink } from '@/features/invites/share'
import { guestUrl } from '@/lib/app-url'

/** A whole number from 1 to 100, or null. */
export function parseGuestCap(text: string): number | null {
  if (!/^\d{1,3}$/.test(text.trim())) return null
  const n = Number(text.trim())
  return n >= 1 && n <= 100 ? n : null
}

/** Native share sheet where there is one, clipboard otherwise. */
export async function shareGuestLink(eventTitle: string, code: string) {
  const url = guestUrl(code)
  await shareLink(
    {
      title: t('guests.shareTitle', { event: eventTitle }),
      text: t('guests.shareText', { event: eventTitle, url }),
      url,
    },
    t('guests.panel.copied'),
  )
}
