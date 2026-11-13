import type { RecurringExpense } from '@potluck/api'
import { formatDate, t } from '@potluck/i18n'
import { Button, ConfirmDialog, IconButton, cn } from '@potluck/ui'
import { Pause, Play, SkipForward, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { dateAfter } from './template'
import { useTemplateActions } from './use-template-actions'

const day = (date: string) => formatDate(date, { timeZone: 'UTC', style: 'weekday' })

/**
 * "Skip next", with the dates it moves between spelled out before anything changes. A full
 * button by default; `icon` for tight rows (the group's list).
 */
export function SkipButton({
  template,
  variant = 'button',
  className,
}: {
  template: RecurringExpense
  variant?: 'button' | 'icon'
  className?: string
}) {
  const { skip } = useTemplateActions(template)
  const [open, setOpen] = useState(false)
  return (
    <>
      {variant === 'icon' ? (
        <IconButton
          size="sm"
          label={t('expenses.recurring.skipLabel', { description: template.description })}
          icon={<SkipForward />}
          onClick={() => setOpen(true)}
          className={className}
        />
      ) : (
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={<SkipForward />}
          onClick={() => setOpen(true)}
          className={className}
        >
          {t('expenses.recurring.skip')}
        </Button>
      )}
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={t('expenses.recurring.skipTitle')}
        description={t('expenses.recurring.skipConfirm', {
          description: template.description,
          date: day(template.next_run_on),
          next: day(dateAfter(template)),
        })}
        confirmLabel={t('expenses.recurring.skip')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        onConfirm={() => skip.mutateAsync()}
      />
    </>
  )
}

/**
 * Skip the next one, pause or resume, and stop: what people do to a repeating expense besides
 * changing it. Skipping and stopping ask first; pausing is undone with one tap. While it names
 * someone who left, it says who and that they need to come out of the split before it can resume.
 */
export function TemplateActions({
  template,
  departedNames,
  onStopped,
  className,
}: {
  template: RecurringExpense
  /** Names of people it names who left the group, if any. */
  departedNames?: string
  onStopped?: () => void
  className?: string
}) {
  const { toggle, remove } = useTemplateActions(template, departedNames)
  const [stopping, setStopping] = useState(false)
  const blocked = !!departedNames

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      {blocked ? (
        <p
          role="note"
          className="rounded-card bg-saffron-soft px-3 py-2.5 text-sm font-medium text-saffron-ink"
        >
          {template.active
            ? t('expenses.recurring.blockedActive', { names: departedNames })
            : t('expenses.recurring.resumeBlocked', { names: departedNames })}
        </p>
      ) : (
        !template.active && (
          <p
            role="note"
            className="rounded-card bg-sunken px-3 py-2.5 text-sm font-medium text-mute"
          >
            {t('expenses.recurring.pausedNote')}
          </p>
        )
      )}
      <div
        role="group"
        aria-label={t('expenses.recurring.actions')}
        className="flex flex-wrap items-center gap-2"
      >
        {template.active && !blocked && <SkipButton template={template} />}
        <Button
          size="sm"
          variant="secondary"
          leadingIcon={template.active ? <Pause /> : <Play />}
          loading={toggle.isPending}
          // A template that still names someone who left cannot resume; the note says why.
          disabled={!template.active && blocked}
          onClick={() => toggle.mutate(!template.active)}
        >
          {template.active ? t('expenses.recurring.pause') : t('expenses.recurring.resume')}
        </Button>
        <Button
          size="sm"
          variant="ghost"
          className="text-tomato-ink"
          leadingIcon={<Trash2 />}
          onClick={() => setStopping(true)}
        >
          {t('expenses.recurring.remove')}
        </Button>
      </div>
      <ConfirmDialog
        open={stopping}
        onOpenChange={setStopping}
        title={t('expenses.recurring.remove')}
        description={t('expenses.recurring.removeConfirm', { description: template.description })}
        confirmLabel={t('expenses.recurring.remove')}
        cancelLabel={t('common.cancel')}
        closeLabel={t('common.close')}
        tone="danger"
        onConfirm={async () => {
          await remove.mutateAsync()
          onStopped?.()
        }}
      />
    </div>
  )
}
