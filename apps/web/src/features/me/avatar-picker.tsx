import { uploadAvatar } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Avatar, LoadingDots, toast } from '@potluck/ui'
import { Camera } from 'lucide-react'
import { useId, useRef, useState } from 'react'
import { supabase } from '@/lib/supabase'

const MAX_BYTES = 5 * 1024 * 1024
const ACCEPT = ['image/png', 'image/jpeg', 'image/webp', 'image/gif']
const EDGE = 512

/** Square-crops and shrinks a photo to 512px WebP. Falls back to the original file. */
async function prepare(file: File): Promise<{ body: ArrayBuffer; type: string }> {
  if (file.type !== 'image/gif' && typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      const side = Math.min(bitmap.width, bitmap.height)
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = Math.min(EDGE, side)
      const ctx = canvas.getContext('2d')
      if (ctx) {
        ctx.drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          canvas.width,
          canvas.height,
        )
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob(resolve, 'image/webp', 0.86),
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

interface AvatarPickerProps {
  userId: string
  name: string
  src: string | null
  /** Called with the new storage path once the upload succeeds. */
  onUploaded: (path: string) => void | Promise<void>
  label?: string
}

/** A big face with a camera badge. Tapping it opens the file picker and uploads. */
export function AvatarPicker({ userId, name, src, onUploaded, label }: AvatarPickerProps) {
  const input = useRef<HTMLInputElement>(null)
  const id = useId()
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)

  async function onFile(file: File | undefined) {
    if (!file) return
    if (!ACCEPT.includes(file.type)) {
      toast.error(t('onboarding.profile.photoType'))
      return
    }
    if (file.size > MAX_BYTES) {
      toast.error(t('onboarding.profile.photoTooBig'))
      return
    }
    const local = URL.createObjectURL(file)
    setPreview(local)
    setBusy(true)
    try {
      const { body, type } = await prepare(file)
      const path = await uploadAvatar(supabase, userId, body, type)
      await onUploaded(path)
    } catch {
      toast.error(t('onboarding.profile.photoFailed'))
      setPreview(null)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="flex items-center gap-4">
      <label htmlFor={id} className="relative cursor-pointer rounded-full">
        <Avatar name={name || '?'} seed={userId} src={preview ?? src} size="xl" />
        <span
          aria-hidden
          className="absolute -right-1 -bottom-1 grid size-8 place-items-center rounded-full bg-ink text-paper ring-4 ring-[var(--pl-card)]"
        >
          {busy ? <LoadingDots size={14} /> : <Camera className="size-4" />}
        </span>
      </label>
      <div>
        <label
          htmlFor={id}
          className="cursor-pointer rounded-pill text-[0.9375rem] font-semibold underline decoration-tomato decoration-2 underline-offset-4"
        >
          {busy
            ? t('onboarding.profile.uploading')
            : (label ?? t('onboarding.profile.avatarLabel'))}
        </label>
        <input
          ref={input}
          id={id}
          type="file"
          accept={ACCEPT.join(',')}
          className="sr-only"
          disabled={busy}
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
      </div>
    </div>
  )
}
