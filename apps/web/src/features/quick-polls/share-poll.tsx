import { t } from '@potluck/i18n'
import { Button, Card, toast } from '@potluck/ui'
import { Copy, Share2 } from 'lucide-react'
import { copyText, shareLink } from '@/features/invites/share'
import { quickPollUrl } from '@/lib/app-url'

/** The phone's share sheet is worth a button of its own; elsewhere Copy link does the job. */
const canShare = () => typeof navigator !== 'undefined' && typeof navigator.share === 'function'

/**
 * The poll's link with Copy and, where there is one, the share sheet. `prominent` is the
 * creator's first look at a new poll: a saffron card that says the next step is sending it.
 */
export function SharePoll({
  code,
  title,
  prominent = false,
}: {
  code: string
  title: string
  prominent?: boolean
}) {
  const url = quickPollUrl(code)
  const copy = async () => {
    if (await copyText(url)) toast.success(t('quickPolls.page.copied'))
  }
  const share = () =>
    shareLink(
      {
        title: t('quickPolls.page.shareTitle', { title }),
        text: t('quickPolls.page.shareText', { title, url }),
        url,
      },
      t('quickPolls.page.copied'),
    )
  const buttons = (
    <div className="flex flex-wrap gap-2">
      <Button
        size={prominent ? 'md' : 'sm'}
        variant={prominent ? 'ink' : 'secondary'}
        leadingIcon={<Copy />}
        onClick={() => void copy()}
      >
        {t('quickPolls.page.copy')}
      </Button>
      {canShare() && (
        <Button
          size={prominent ? 'md' : 'sm'}
          variant={prominent ? 'secondary' : 'ghost'}
          leadingIcon={<Share2 />}
          onClick={() => void share()}
        >
          {t('quickPolls.page.share')}
        </Button>
      )}
    </div>
  )

  if (!prominent) return buttons

  return (
    <Card tone="saffron" padding="roomy" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="flourish text-3xl leading-tight">{t('quickPolls.page.readyTitle')}</h2>
        <p className="text-pretty">{t('quickPolls.page.readyBody')}</p>
      </div>
      <p className="truncate rounded-[0.75rem] bg-card/70 px-3.5 py-2.5 text-sm font-semibold text-ink">
        <span className="sr-only">{t('quickPolls.page.linkLabel')}: </span>
        {url}
      </p>
      {buttons}
    </Card>
  )
}
