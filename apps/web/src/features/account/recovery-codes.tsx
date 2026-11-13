import { t } from '@potluck/i18n'
import { Button, toast } from '@potluck/ui'
import { Copy, Download } from 'lucide-react'
import { copyText } from '@/features/invites/share'

function download(codes: string[]) {
  const url = URL.createObjectURL(new Blob([`${codes.join('\n')}\n`], { type: 'text/plain' }))
  const a = document.createElement('a')
  a.href = url
  a.download = t('security.twoFactor.recovery.fileName')
  a.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/**
 * The codes printed like the bottom of a bill: a torn edge, two neat columns, and the two ways
 * to take them home.
 */
export function RecoveryCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className="grid gap-4 pt-2">
      <p className="text-sm text-mute">{t('security.twoFactor.recovery.body')}</p>
      <div className="relative rounded-b-card border border-t-0 border-line bg-paper px-4 pt-5 pb-4">
        {/* The perforation: a row of punched holes along the top. */}
        <div
          aria-hidden
          className="absolute inset-x-0 top-0 h-2 bg-[radial-gradient(circle_at_6px_0,transparent_5px,var(--pl-line)_5px,var(--pl-line)_6px,transparent_6px)] bg-[length:12px_8px] bg-repeat-x"
        />
        <ul
          aria-label={t('security.twoFactor.recovery.title')}
          className="grid grid-cols-2 gap-x-4 gap-y-2.5 text-center text-[0.9375rem] font-bold tracking-[0.08em] tabular-nums"
        >
          {codes.map((code) => (
            <li key={code} className="select-all">
              {code}
            </li>
          ))}
        </ul>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Copy />}
          onClick={async () => {
            if (await copyText(codes.join('\n'))) toast.success(t('common.copied'))
          }}
        >
          {t('security.twoFactor.recovery.copy')}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          leadingIcon={<Download />}
          onClick={() => download(codes)}
        >
          {t('security.twoFactor.recovery.download')}
        </Button>
      </div>
      <Button variant="ink" block onClick={onDone}>
        {t('security.twoFactor.recovery.done')}
      </Button>
    </div>
  )
}
