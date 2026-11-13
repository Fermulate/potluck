import { MAX_ATTACHMENTS, moneyQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { IconButton, Spinner, toast } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Camera, FileText, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Help } from '@/features/help/help'
import { supabase } from '@/lib/supabase'
import { RECEIPT_ACCEPT } from '../form/receipt'
import {
  addDrafts,
  attachmentName,
  draftFromFile,
  isPdf,
  type AttachmentDraft,
} from './attachments-state'
import { prepareImage } from './image'

const MAX_BYTES = 10 * 1024 * 1024

/** Receipts, photos and PDFs on the expense form: up to five, shrunk on the device first. */
export function AttachmentsField({
  value,
  onChange,
}: {
  value: AttachmentDraft[]
  onChange: (next: AttachmentDraft[]) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const [preparing, setPreparing] = useState(0)
  // The latest list, for files that finish shrinking after the person changed something else.
  const latest = useRef(value)
  useEffect(() => {
    latest.current = value
  }, [value])
  const full = value.length + preparing >= MAX_ATTACHMENTS

  const pick = async (files: File[]) => {
    const room = MAX_ATTACHMENTS - latest.current.length - preparing
    if (files.length > room) toast.message(t('expenses.attachments.leftOut'))
    const taken = files.slice(0, Math.max(0, room))
    const usable = taken.filter((file) => {
      if (!draftFromFile(file)) {
        toast.error(t('expenses.receiptUpload.wrongType'))
        return false
      }
      return true
    })
    if (usable.length === 0) return
    setPreparing((n) => n + usable.length)
    const ready = await Promise.all(usable.map(prepareImage))
    setPreparing((n) => n - usable.length)
    const drafts = ready.flatMap((file) => {
      if (file.size > MAX_BYTES) {
        toast.error(t('expenses.receiptUpload.tooBig'))
        return []
      }
      const draft = draftFromFile(file)
      return draft ? [draft] : []
    })
    onChange(addDrafts(latest.current, drafts).drafts)
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between gap-3">
        <span id={`${id}-label`} className="text-sm font-semibold text-ink">
          {t('expenses.attachments.label')}
          {value.length > 0 && (
            <span className="ml-2 tabular font-normal text-mute">
              {t('expenses.attachments.count', { count: value.length, max: MAX_ATTACHMENTS })}
            </span>
          )}
        </span>
        <Help topic="receipts" />
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={RECEIPT_ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={`${id}-label`}
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          e.target.value = ''
          void pick(files)
        }}
      />
      <ul aria-labelledby={`${id}-label`} className="flex flex-wrap gap-2.5">
        {value.map((draft, index) => (
          <Tile
            key={draft.key}
            draft={draft}
            index={index}
            onRemove={() => onChange(value.filter((d) => d.key !== draft.key))}
          />
        ))}
        {Array.from({ length: preparing }, (_, i) => (
          <li
            key={`preparing-${i}`}
            className="grid size-20 place-items-center rounded-[0.875rem] border border-line bg-sunken"
          >
            <Spinner label={t('expenses.attachments.preparing')} />
          </li>
        ))}
        {!full && (
          <li>
            <button
              type="button"
              onClick={() => inputRef.current?.click()}
              aria-label={t('expenses.attachments.addLabel')}
              className="flex size-20 flex-col items-center justify-center gap-1 rounded-[0.875rem] border border-dashed border-line-strong text-xs font-semibold text-mute transition-colors hover:border-ink/40 hover:text-ink"
            >
              <Camera aria-hidden className="size-5" />
              {t('expenses.attachments.add')}
            </button>
          </li>
        )}
      </ul>
      {full && value.length >= MAX_ATTACHMENTS && (
        <p className="text-xs text-mute">{t('expenses.attachments.full')}</p>
      )}
    </div>
  )
}

function Tile({
  draft,
  index,
  onRemove,
}: {
  draft: AttachmentDraft
  index: number
  onRemove: () => void
}) {
  const local = useMemo(() => (draft.file ? URL.createObjectURL(draft.file) : null), [draft.file])
  useEffect(
    () => () => {
      if (local) URL.revokeObjectURL(local)
    },
    [local],
  )
  const stored = useQuery({
    ...moneyQueries.receiptUrl(supabase, draft.path ?? ''),
    enabled: !draft.file && !!draft.path && !isPdf(draft),
  })
  const src = local ?? stored.data
  const name = attachmentName(draft, index)
  return (
    <li className="relative size-20">
      {!isPdf(draft) && src ? (
        <img
          src={src}
          alt={name}
          className="size-20 rounded-[0.875rem] border border-line bg-sunken object-cover"
        />
      ) : (
        <span
          role="img"
          aria-label={name}
          className="flex size-20 flex-col items-center justify-center gap-1 rounded-[0.875rem] border border-line bg-sunken text-xs font-semibold text-mute"
        >
          <FileText aria-hidden className="size-5" />
          <span aria-hidden>{name}</span>
        </span>
      )}
      <IconButton
        size="sm"
        label={t('expenses.attachments.remove', { name })}
        icon={<X />}
        onClick={onRemove}
        className="shadow-sm absolute -top-2 -right-2 size-7 border border-line bg-card"
      />
    </li>
  )
}
