import { Button, Card, Stamp, StampAnimation } from '@potluck/ui'

/**
 * Someone without an account just sent their times: an olive stamp, a thank you and a way back
 * into editing. `stamp` plays the stamp's landing, only right after sending.
 */
export function SentCard({
  stamp,
  stampLabel,
  title,
  body,
  actionLabel,
  onAction,
}: {
  stamp: boolean
  stampLabel: string
  title: string
  body: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <Card tone="sunken" padding="roomy" className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="shrink-0 self-start sm:self-center">
        {stamp ? (
          <StampAnimation show rotate={-8}>
            <Stamp tone="olive">{stampLabel}</Stamp>
          </StampAnimation>
        ) : (
          <span className="inline-flex -rotate-[8deg]">
            <Stamp tone="olive">{stampLabel}</Stamp>
          </span>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <p role="status" className="flourish text-2xl leading-tight">
          {title}
        </p>
        <p className="text-sm text-mute">{body}</p>
      </div>
      <Button variant="secondary" className="self-start sm:self-center" onClick={onAction}>
        {actionLabel}
      </Button>
    </Card>
  )
}
