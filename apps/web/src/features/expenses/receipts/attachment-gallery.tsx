import { attachmentQueries, moneyQueries, type ExpenseAttachment } from '@potluck/api'
import { t } from '@potluck/i18n'
import { IconButton, Sheet, SheetContent, Skeleton, buttonClassName, cn } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, ExternalLink, FileText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { attachmentName } from './attachments-state'
import { ZoomableImage } from './zoomable-image'

const asDraft = (a: ExpenseAttachment) => ({ contentType: a.content_type })
const isPdf = (a: ExpenseAttachment) => a.content_type === 'application/pdf'

/**
 * Receipts and photos on the expense page. Each opens full screen, where it pinches and double
 * taps to zoom; swipes, arrow keys and the buttons move between them. Links are signed for an hour, for members of the group only.
 */
export function AttachmentGallery({
  expenseId,
  receiptPath,
  description,
}: {
  expenseId: string
  /** Shown first while the list loads, so an expense with a receipt never flashes empty. */
  receiptPath: string | null
  description: string
}) {
  const list = useQuery(attachmentQueries.list(supabase, expenseId))
  const [open, setOpen] = useState<number | null>(null)
  if (!list.data) return receiptPath ? <Section count={1} loading /> : null
  const files = list.data
  if (files.length === 0) return null
  const current = open === null ? null : files[open]

  return (
    <Section count={files.length}>
      <ul
        className={cn(
          'grid gap-2.5',
          files.length === 1 ? 'grid-cols-1' : 'grid-cols-2 sm:grid-cols-3',
        )}
      >
        {files.map((file, index) => (
          <li key={file.path}>
            <Thumb
              file={file}
              index={index}
              large={files.length === 1}
              description={description}
              onOpen={() => setOpen(index)}
            />
          </li>
        ))}
      </ul>
      <Sheet open={current !== null} onOpenChange={(next) => !next && setOpen(null)}>
        {current && open !== null && (
          <Viewer
            file={current}
            index={open}
            count={files.length}
            description={description}
            onMove={(step) => setOpen((open + step + files.length) % files.length)}
          />
        )}
      </Sheet>
    </Section>
  )
}

function Section({
  count,
  loading,
  children,
}: {
  count: number
  loading?: boolean
  children?: React.ReactNode
}) {
  return (
    <section aria-labelledby="attachments-title" className="flex flex-col gap-3">
      <h2 id="attachments-title" className="font-display text-2xl">
        {count > 1 ? t('expenses.attachments.label') : t('expenses.detail.receipt')}
      </h2>
      {loading ? <Skeleton className="h-56" /> : children}
    </section>
  )
}

function useSigned(file: ExpenseAttachment) {
  return useQuery(moneyQueries.receiptUrl(supabase, file.path)).data
}

function Thumb({
  file,
  index,
  large,
  description,
  onOpen,
}: {
  file: ExpenseAttachment
  index: number
  large: boolean
  description: string
  onOpen: () => void
}) {
  const url = useSigned(file)
  const name = attachmentName(asDraft(file), index)
  if (isPdf(file)) {
    return url ? (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        aria-label={t('expenses.attachments.open', { name })}
        className={cn(
          'flex items-center gap-2 rounded-card border border-line bg-card font-semibold whitespace-nowrap hover:border-line-strong',
          large ? 'min-h-24 p-4' : 'aspect-square flex-col justify-center p-2',
        )}
      >
        <FileText aria-hidden className="size-6 shrink-0 text-mute" />
        <span className="inline-flex items-center gap-1">
          {name}
          <ExternalLink aria-hidden className="size-3.5 shrink-0 text-mute" />
        </span>
      </a>
    ) : (
      <Skeleton className="h-24" />
    )
  }
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={t('expenses.attachments.open', { name })}
      className="block w-full overflow-hidden rounded-card border border-line bg-sunken transition-[transform,border-color] duration-150 hover:border-line-strong active:scale-[0.99]"
    >
      {url ? (
        <img
          src={url}
          alt={t('expenses.attachments.alt', { number: index + 1, description })}
          className={cn(
            'w-full',
            large ? 'max-h-[28rem] object-contain' : 'aspect-square object-cover',
          )}
        />
      ) : (
        <Skeleton className={large ? 'h-56' : 'aspect-square'} />
      )}
    </button>
  )
}

function Viewer({
  file,
  index,
  count,
  description,
  onMove,
}: {
  file: ExpenseAttachment
  index: number
  count: number
  description: string
  onMove: (step: 1 | -1) => void
}) {
  const url = useSigned(file)
  useEffect(() => {
    if (count < 2) return
    const onKeyDown = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'ArrowRight') onMove(1)
      if (e.key === 'ArrowLeft') onMove(-1)
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [count, onMove])
  return (
    <SheetContent
      variant="fullscreen"
      title={t('expenses.attachments.position', { number: index + 1, count })}
      description={description}
      closeLabel={t('common.close')}
      footer={
        <div className="flex items-center justify-between gap-3">
          {count > 1 ? (
            <IconButton
              label={t('expenses.attachments.previous')}
              icon={<ChevronLeft />}
              variant="secondary"
              onClick={() => onMove(-1)}
            />
          ) : (
            <span />
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className={buttonClassName({ variant: 'ghost', size: 'sm' })}
            >
              <ExternalLink aria-hidden className="size-4" />
              {isPdf(file)
                ? t('expenses.attachments.openPdf')
                : t('expenses.attachments.openOriginal')}
            </a>
          )}
          {count > 1 ? (
            <IconButton
              label={t('expenses.attachments.next')}
              icon={<ChevronRight />}
              variant="secondary"
              onClick={() => onMove(1)}
            />
          ) : (
            <span />
          )}
        </div>
      }
    >
      {isPdf(file) ? (
        <div className="grid h-full min-h-[50dvh] place-items-center rounded-card bg-sunken">
          <FileText aria-hidden className="size-16 text-mute" />
        </div>
      ) : url ? (
        <ZoomableImage
          key={url}
          src={url}
          alt={t('expenses.attachments.alt', { number: index + 1, description })}
          onSwipe={count > 1 ? onMove : undefined}
          className="h-[calc(100dvh-11rem)] min-h-[50dvh] w-full"
          frameClassName="min-h-0 flex-1 rounded-card bg-sunken"
        />
      ) : (
        <Skeleton className="h-[60dvh] w-full" />
      )}
    </SheetContent>
  )
}
