import { t } from '@potluck/i18n'
import { cn } from '@potluck/ui'
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
 * until the connection is back; a save that went out just as the connection dropped is paused
 * by React Query and resumes on its own, and this says so instead of an endless spinner.
 */
export function OfflineSaveNote({ paused = false }: { paused?: boolean }) {
  const online = useOnline()
  return (
    <p role="status" className="text-sm font-medium text-saffron-ink empty:hidden">
      {paused ? t('app.offline.paused') : !online ? t('app.offline.form') : null}
    </p>
  )
}
