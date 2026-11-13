import { friendsQueryOptions } from '@potluck/api'
import { t } from '@potluck/i18n'
import { Button, Card, Field, Select } from '@potluck/ui'
import { useQuery } from '@tanstack/react-query'
import { Archive, FileSpreadsheet, Users } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Help } from '@/features/help/help'
import { useUserId } from '@/lib/auth'
import { supabase } from '@/lib/supabase'
import { useAccountExports } from './use-exports'

function Row({
  icon,
  title,
  hint,
  children,
}: {
  icon: ReactNode
  title: string
  hint: string
  children: ReactNode
}) {
  return (
    <div className="grid gap-3 border-line not-first:border-t not-first:pt-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="grid size-10 shrink-0 place-items-center rounded-full bg-saffron-soft text-saffron-ink [&_svg]:size-5"
        >
          {icon}
        </span>
        <div>
          <p className="font-semibold">{title}</p>
          <p className="text-sm text-mute">{hint}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-end gap-2 sm:justify-end">{children}</div>
    </div>
  )
}

/**
 * Me, Your data: the JSON backup, everything as one spreadsheet, and what you share with one
 * friend. Importing lives on the group it goes into.
 */
export function YourDataSection() {
  const viewerId = useUserId()
  const exports = useAccountExports()
  const friends = useQuery(friendsQueryOptions(supabase, viewerId))
  const [friendId, setFriendId] = useState('')
  const friend = friends.data?.find((f) => f.id === friendId)

  return (
    <section aria-labelledby="me-data" className="grid gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 id="me-data" className="text-sm font-bold text-mute">
          {t('transfer.yourData.title')}
        </h2>
        <Help topic="yourData" />
      </div>
      <Card padding="roomy" className="grid grid-cols-[minmax(0,1fr)] gap-5">
        <p className="text-sm text-mute">{t('transfer.yourData.intro')}</p>
        <Row
          icon={<Archive />}
          title={t('transfer.yourData.backupTitle')}
          hint={t('transfer.yourData.backupHint')}
        >
          <Button
            size="sm"
            variant="ink"
            loading={exports.busy === 'backup'}
            disabled={exports.busy !== null}
            onClick={exports.backup}
          >
            {t('transfer.yourData.backup')}
          </Button>
        </Row>
        <Row
          icon={<FileSpreadsheet />}
          title={t('transfer.yourData.everythingTitle')}
          hint={t('transfer.yourData.everythingHint')}
        >
          <Button
            size="sm"
            variant="secondary"
            loading={exports.busy === 'everything'}
            disabled={exports.busy !== null}
            onClick={exports.everything}
          >
            {t('transfer.yourData.everything')}
          </Button>
        </Row>
        <Row
          icon={<Users />}
          title={t('transfer.yourData.friend')}
          hint={
            friends.data && friends.data.length === 0
              ? t('transfer.yourData.noFriends')
              : t('transfer.yourData.friendHint')
          }
        >
          {(friends.data?.length ?? 0) > 0 && (
            <>
              <Field
                label={t('transfer.yourData.friendLabel')}
                hideLabel
                className="min-w-44 flex-1"
              >
                <Select
                  value={friendId}
                  onValueChange={setFriendId}
                  placeholder={t('transfer.yourData.friendPick')}
                  className="h-9"
                  options={(friends.data ?? []).map((f) => ({
                    value: f.id,
                    label: f.display_name,
                  }))}
                />
              </Field>
              <Button
                size="sm"
                variant="secondary"
                loading={exports.busy === 'friend'}
                disabled={!friend || exports.busy !== null}
                onClick={() => friend && exports.friend(friend.id, friend.display_name)}
              >
                {t('transfer.yourData.friendExport')}
              </Button>
            </>
          )}
        </Row>
        <p className="border-t border-line pt-5 text-sm text-mute">
          {t('transfer.yourData.importHint')}
        </p>
      </Card>
    </section>
  )
}
