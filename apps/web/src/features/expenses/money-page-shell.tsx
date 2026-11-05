import { springs } from '@potluck/tokens'
import { t } from '@potluck/i18n'
import { IconButton, cn, useIsDesktop, usePrefersReducedMotion } from '@potluck/ui'
import { X } from 'lucide-react'
import { motion } from 'motion/react'
import { useEffect, type ReactNode } from 'react'

/**
 * Frame for the add expense and settle up flows: a full-screen sheet that slides up on phones,
 * a centered card on the page from md up. Escape closes it.
 */
export function MoneyPageShell({
  title,
  onClose,
  footer,
  aside,
  width = 'md',
  children,
}: {
  title: ReactNode
  onClose: () => void
  footer?: ReactNode
  /** Something on the right of the title bar. */
  aside?: ReactNode
  width?: 'md' | 'lg'
  children: ReactNode
}) {
  const desktop = useIsDesktop()
  const reduced = usePrefersReducedMotion()

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented && !document.querySelector('[role="dialog"]')) {
        onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="md:px-6 md:py-8 lg:py-10">
      <motion.section
        aria-labelledby="money-page-title"
        initial={desktop || reduced ? { opacity: 0 } : { y: '100%' }}
        animate={desktop || reduced ? { opacity: 1 } : { y: 0 }}
        transition={reduced ? { duration: 0.15 } : desktop ? { duration: 0.2 } : springs.gentle}
        className={cn(
          'fixed inset-0 z-40 flex flex-col bg-card text-ink',
          'md:static md:mx-auto md:min-h-0 md:rounded-sheet md:border md:border-line md:shadow-sheet',
          width === 'lg' ? 'md:max-w-5xl' : 'md:max-w-xl',
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-line px-3 pt-safe md:px-5">
          <div className="flex h-14 w-full items-center gap-2 md:h-16">
            <IconButton label={t('common.close')} icon={<X />} onClick={onClose} />
            <h1 id="money-page-title" className="min-w-0 flex-1 truncate text-lg font-bold">
              {title}
            </h1>
            {aside}
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain md:overflow-visible">
          {children}
        </div>
        {footer && (
          <footer className="shrink-0 border-t border-line bg-card px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] md:rounded-b-sheet md:px-6">
            {footer}
          </footer>
        )}
      </motion.section>
    </div>
  )
}
