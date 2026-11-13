import {
  groupKeys,
  removeCoverFile,
  updateGroup,
  uploadCover,
  type GroupDetail,
} from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, LoadingDots, toast } from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { ImagePlus, Trash2 } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { errorMessage } from '@/lib/errors'
import { coverSrc } from '@/lib/queries'
import { supabase } from '@/lib/supabase'
import { GroupTile } from './group-bits'

/** What the bucket takes (`group-covers`: 10 MB). Checked after shrinking. */
const MAX_BYTES = 10 * 1024 * 1024
/** Phones take big photos; anything up to this is worth trying to shrink first. */
const MAX_INPUT_BYTES = 40 * 1024 * 1024
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp']
const WIDTH = 1600

/** Shrinks a photo to at most 1600px wide WebP (16:7 crop is left to CSS). Falls back to the file. */
async function prepare(file: File): Promise<{ body: ArrayBuffer; type: string }> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const scale = Math.min(1, WIDTH / bitmap.width)
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(bitmap.width * scale)
      canvas.height = Math.round(bitmap.height * scale)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', 0.84),
        )
        if (blob && blob.type === 'image/webp') {
          return { body: await blob.arrayBuffer(), type: 'image/webp' }
        }
      }
    } catch {
      // Keep the original below.
    }
  }
  return { body: await file.arrayBuffer(), type: file.type }
}

/**
 * The cover photo in group settings: a wide preview, upload or change, and remove. Owners and
 * admins only (storage and the groups policy check the same).
 */
export function CoverPicker({ group }: { group: GroupDetail }) {
  const queryClient = useQueryClient()
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const src = preview ?? coverSrc(group.cover_path)

  async function setPath(path: string | null) {
    const previous = group.cover_path
    await updateGroup(supabase, group.id, { cover_path: path })
    await queryClient.invalidateQueries({ queryKey: groupKeys.all })
    // The old file is no longer shown anywhere; losing it is fine if this fails.
    if (previous) await removeCoverFile(supabase, previous).catch(() => undefined)
  }

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!ACCEPT.includes(file.type)) {
      toast.error(t('groups.cover.wrongType'))
      return
    }
    if (file.size > MAX_INPUT_BYTES) {
      toast.error(t('groups.cover.tooBig'))
      return
    }
    setPreview(URL.createObjectURL(file))
    setBusy(true)
    try {
      const { body, type } = await prepare(file)
      if (body.byteLength > MAX_BYTES) {
        toast.error(t('groups.cover.tooBig'))
        return
      }
      const path = await uploadCover(supabase, group.id, body, type)
      await setPath(path)
      toast.success(t('groups.cover.saved'))
    } catch {
      toast.error(t('groups.cover.failed'))
    } finally {
      setPreview(null)
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await setPath(null)
      toast.success(t('groups.cover.removed'))
    } catch (error) {
      toast.error(errorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="relative">
        {src ? (
          <img
            src={src}
            alt={t('groups.cover.alt', { group: group.name })}
            className="aspect-[16/7] w-full rounded-card bg-sunken object-cover"
          />
        ) : (
          // A big drop target for the same file input; the labelled control is the button below.
          <label
            aria-hidden
            htmlFor={id}
            className="grid aspect-[16/7] w-full cursor-pointer place-items-center rounded-card border-2 border-dashed border-line-strong bg-sunken text-mute transition-colors hover:border-ink/40 hover:text-ink"
          >
            <span className="flex flex-col items-center gap-2 text-sm font-semibold">
              <GroupTile emoji={group.emoji} color={group.color} size="sm" />
              {t('groups.cover.add')}
            </span>
          </label>
        )}
        {busy && (
          <span className="absolute inset-0 grid place-items-center rounded-card bg-ink/30 text-paper">
            <LoadingDots size={20} />
            <span className="sr-only">{t('groups.cover.uploading')}</span>
          </span>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label
          htmlFor={id}
          className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-pill border border-line-strong bg-card px-4 text-sm font-semibold hover:border-ink/40 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus"
        >
          <ImagePlus aria-hidden className="size-4" />
          {group.cover_path ? t('groups.cover.change') : t('groups.cover.add')}
          <input
            ref={input}
            id={id}
            type="file"
            accept={ACCEPT.join(',')}
            className="sr-only"
            disabled={busy}
            onChange={(e) => void onFile(e.target.files?.[0])}
          />
        </label>
        {group.cover_path && (
          <Button
            variant="ghost"
            size="sm"
            leadingIcon={<Trash2 />}
            disabled={busy}
            onClick={() => void remove()}
          >
            {t('groups.cover.remove')}
          </Button>
        )}
      </div>
      <p className="text-xs text-mute">{t('groups.cover.hint')}</p>
    </div>
  )
}
