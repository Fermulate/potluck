import { moneyQueries } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, IconButton, toast } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Camera, FileText, X } from 'lucide-react'
import { useEffect, useId, useMemo, useRef } from 'react'
import { supabase } from '@/lib/supabase'

export interface ReceiptValue {
  /** A new file to upload on save. */
  file: File | null
  /** The stored path when editing, null once removed. */
  existingPath: string | null
}

const MAX_BYTES = 10 * 1024 * 1024
const TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/heic', 'application/pdf']

function useObjectUrl(file: File | null) {
  const url = useMemo(() => (file ? URL.createObjectURL(file) : null), [file])
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url)
    },
    [url],
  )
  return url
}

export function ReceiptField({
  value,
  onChange,
}: {
  value: ReceiptValue
  onChange: (value: ReceiptValue) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const id = useId()
  const localUrl = useObjectUrl(value.file)
  const stored = useQuery({
    ...moneyQueries.receiptUrl(supabase, value.existingPath ?? ''),
    enabled: !value.file && !!value.existingPath,
  })
  const isPdf = value.file
    ? value.file.type === 'application/pdf'
    : (value.existingPath ?? '').toLowerCase().endsWith('.pdf')
  const src = value.file ? localUrl : value.existingPath ? stored.data : null
  const hasReceipt = !!value.file || !!value.existingPath

  const pick = (file: File | undefined) => {
    if (!file) return
    if (!TYPES.includes(file.type)) {
      toast.error(t('expenses.receiptUpload.wrongType'))
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('expenses.receiptUpload.tooBig'))
      return
    }
    onChange({ ...value, file })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-sm font-semibold text-ink">
        {t('expenses.fields.receipt')}
      </span>
      <input
        ref={inputRef}
        type="file"
        accept={TYPES.join(',')}
        className="sr-only"
        tabIndex={-1}
        aria-labelledby={`${id}-label`}
        onChange={(e) => {
          pick(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      {hasReceipt ? (
        <div className="flex items-center gap-3 rounded-card border border-line bg-card p-2 pr-3">
          {src && !isPdf ? (
            <img
              src={src}
              alt=""
              className="size-16 shrink-0 rounded-[0.75rem] border border-line object-cover"
            />
          ) : (
            <span className="grid size-16 shrink-0 place-items-center rounded-[0.75rem] bg-sunken text-mute">
              <FileText aria-hidden className="size-6" />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {value.file?.name ?? t('expenses.fields.receipt')}
          </span>
          <Button size="sm" variant="ghost" onClick={() => inputRef.current?.click()}>
            {t('expenses.receiptUpload.change')}
          </Button>
          <IconButton
            size="sm"
            label={t('expenses.fields.removeReceipt')}
            icon={<X />}
            onClick={() => onChange({ file: null, existingPath: null })}
          />
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex h-14 items-center justify-center gap-2 rounded-card border border-dashed border-line-strong text-[0.9375rem] font-semibold text-mute transition-colors hover:border-ink/40 hover:text-ink"
        >
          <Camera aria-hidden className="size-5" />
          {t('expenses.fields.addReceipt')}
        </button>
      )}
    </div>
  )
}
