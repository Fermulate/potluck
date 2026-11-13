import { t } from '@potluck/i18n'
import { Button, Card } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { Download, Upload } from 'lucide-react'
import { Help } from '@/features/help/help'
import { useGroupExport } from './use-exports'

/** Group settings, Spreadsheets: export this group, or import a file into it. */
export function GroupDataSection({ groupId, archived }: { groupId: string; archived: boolean }) {
  const { exportGroup, busy } = useGroupExport(groupId)
  return (
    <section className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-sm font-bold text-mute">{t('transfer.group.title')}</h3>
        <Help topic="importExpenses" />
      </div>
      <Card padding="roomy" className="grid gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="max-w-sm text-sm text-mute">{t('transfer.group.exportHint')}</p>
          <Button
            variant="secondary"
            leadingIcon={<Download />}
            loading={busy}
            onClick={exportGroup}
          >
            {t('transfer.group.export')}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line pt-5">
          <p className="max-w-sm text-sm text-mute">
            {archived ? t('transfer.group.importArchived') : t('transfer.group.importHint')}
          </p>
          {!archived && (
            <Button asChild variant="secondary">
              <Link to="/groups/$groupId/import" params={{ groupId }}>
                <Upload aria-hidden className="-ml-1 size-4" />
                {t('transfer.group.import')}
              </Link>
            </Button>
          )}
        </div>
      </Card>
    </section>
  )
}
