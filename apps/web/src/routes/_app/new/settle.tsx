import { createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { GroupPicker } from '@/features/expenses/group-picker'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { validateSettleSearch } from '@/features/expenses/search-params'
import { SettleFlow } from '@/features/settle/settle-flow'

export const Route = createFileRoute('/_app/new/settle')({
  validateSearch: validateSettleSearch,
  component: Settle,
})

function Settle() {
  const { groupId, to, amount } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  // Only step back inside the app; a shared or typed link has nothing in-app to return to.
  const canGoBack = useCanGoBack()
  const close = () => {
    if (canGoBack) router.history.back()
    else if (groupId) void navigate({ to: '/groups/$groupId/balances', params: { groupId } })
    else void navigate({ to: '/home' })
  }

  if (!groupId) {
    return (
      <MoneyPageShell title={t('settle.title')} onClose={close}>
        <div className="px-4 py-6 md:px-6">
          <GroupPicker
            title={t('settle.pickGroup')}
            onPick={(group) =>
              void navigate({ to: '/new/settle', search: { groupId: group.id }, replace: true })
            }
          />
        </div>
      </MoneyPageShell>
    )
  }

  return (
    <SettleFlow
      key={groupId}
      groupId={groupId}
      to={to}
      amount={amount}
      onClose={close}
      onPickPerson={(userId, cents) =>
        void navigate({
          to: '/new/settle',
          search: { groupId, to: userId, amount: cents },
          replace: !!userId === !!to,
        })
      }
      onFinish={() =>
        void navigate({ to: '/groups/$groupId/balances', params: { groupId }, replace: true })
      }
    />
  )
}
