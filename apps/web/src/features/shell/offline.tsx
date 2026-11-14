import { t } from '@potluck/i18n'
import { Button, cn } from '@potluck/ui'
import { WifiOff } from 'lucide-react'
import { useOnline } from '@/lib/online'

/**
 * A small pill while the browser is offline, on every screen: above the tab bar on a phone, at
 * the top on a desktop (toasts take the bottom right there). The live region is always in the
 * page so a screen reader hears it appear. Full-screen forms cover it and say it themselves
 * next to their save button (`OfflineSaveNote`).
 */
export function OfflineBanner() {
  const online = useOnline()
  return (
    <div
      role="status"
      className={cn(
        'pointer-events-none fixed left-1/2 z-[35] -translate-x-1/2',
        'bottom-[calc(4.25rem+env(safe-area-inset-bottom)+0.75rem)] lg:top-2 lg:bottom-auto',
      )}
    >
      {!online && (
        <p className="inline-flex max-w-[calc(100vw-2rem)] items-center gap-2 rounded-pill bg-ink px-4 py-2 text-sm font-semibold text-paper shadow-pop">
          <WifiOff aria-hidden className="size-4 shrink-0" />
          {t('app.offline.banner')}
        </p>
      )}
    </div>
  )
}

/**
 * Next to a save button: offline, the button is disabled and this says the entry stays put
 * until the connection is back. When a save `failed` because Potluck could not be reached, it
 * says what was typed is still here and offers Try again (`onRetry`) once back online. Nothing
 * retries on its own: a request that did arrive could otherwise be saved twice.
 */
export function OfflineSaveNote({
  failed = false,
  onRetry,
}: {
  failed?: boolean
  onRetry?: () => void
}) {
  const online = useOnline()
  return (
    <div
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-2', online && !failed && 'hidden')}
    >
      <p role="status" className="text-sm font-medium text-saffron-ink">
        {failed ? t('app.offline.failed') : !online ? t('app.offline.form') : null}
      </p>
      {failed && onRetry && (
        <Button size="sm" variant="secondary" disabled={!online} onClick={onRetry}>
          {t('common.retry')}
        </Button>
      )}
    </div>
  )
}
