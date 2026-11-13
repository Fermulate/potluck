import { t } from '@potluck/i18n'
import { IconButton, cn } from '@potluck/ui'
import { ZoomIn, ZoomOut } from 'lucide-react'
import { MAX_ZOOM, useZoomPan } from './use-zoom-pan'

/**
 * A photo that pinches, double taps and drags to zoom, with buttons for the keyboard. Swiping
 * sideways when it is not zoomed calls `onSwipe`. Key it by `src` so a new photo starts unzoomed.
 */
export function ZoomableImage({
  src,
  alt,
  onSwipe,
  className,
  imageClassName,
}: {
  src: string
  alt: string
  onSwipe?: (step: 1 | -1) => void
  className?: string
  imageClassName?: string
}) {
  const zoom = useZoomPan({ onSwipe })
  return (
    <div
      {...zoom.frameProps}
      className={cn('relative grid cursor-zoom-in place-items-center overflow-hidden', className)}
    >
      <img
        src={src}
        alt={alt}
        draggable={false}
        style={zoom.style}
        className={cn('max-h-full max-w-full object-contain select-none', imageClassName)}
      />
      <span className="absolute right-2 bottom-2 flex gap-1">
        <IconButton
          size="sm"
          variant="secondary"
          label={t('expenses.attachments.zoomOut')}
          icon={<ZoomOut />}
          disabled={zoom.view.scale <= 1}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={zoom.zoomOut}
        />
        <IconButton
          size="sm"
          variant="secondary"
          label={t('expenses.attachments.zoomIn')}
          icon={<ZoomIn />}
          disabled={zoom.view.scale >= MAX_ZOOM}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={zoom.zoomIn}
        />
      </span>
    </div>
  )
}
