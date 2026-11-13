import { t } from '@potluck/i18n'
import { IconButton, cn } from '@potluck/ui'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { useId } from 'react'
import { MAX_ZOOM, useZoomPan } from './use-zoom-pan'

/**
 * A photo that pinches, double taps and drags to zoom. The zoom buttons sit under it, never on
 * the print; with the photo focused, + and - zoom and the arrow keys move it. Swiping sideways
 * when it is not zoomed calls `onSwipe`. Key it by `src` so a new photo starts unzoomed.
 */
export function ZoomableImage({
  src,
  alt,
  onSwipe,
  className,
  frameClassName,
}: {
  src: string
  alt: string
  onSwipe?: (step: 1 | -1) => void
  /** The whole block: frame and buttons. */
  className?: string
  /** The frame the photo sits in: its height, border and background. */
  frameClassName?: string
}) {
  const zoom = useZoomPan({ onSwipe })
  const hint = useId()
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div
        {...zoom.frameProps}
        tabIndex={0}
        aria-describedby={hint}
        className={cn(
          'relative grid cursor-zoom-in place-items-center overflow-hidden focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink',
          zoom.view.scale > 1 && 'cursor-grab',
          frameClassName,
        )}
      >
        <img
          src={src}
          alt={alt}
          draggable={false}
          style={zoom.style}
          className="max-h-full max-w-full object-contain select-none"
        />
      </div>
      <span id={hint} className="sr-only">
        {t('expenses.attachments.zoomKeys')}
      </span>
      <span className="flex justify-end gap-1">
        <IconButton
          size="sm"
          variant="secondary"
          label={t('expenses.attachments.zoomOut')}
          icon={<ZoomOut />}
          disabled={zoom.view.scale <= 1}
          onClick={zoom.zoomOut}
          className="disabled:text-mute/60 disabled:opacity-100"
        />
        <IconButton
          size="sm"
          variant="secondary"
          label={t('expenses.attachments.zoomIn')}
          icon={<ZoomIn />}
          disabled={zoom.view.scale >= MAX_ZOOM}
          onClick={zoom.zoomIn}
          className="disabled:text-mute/60 disabled:opacity-100"
        />
      </span>
    </div>
  )
}
