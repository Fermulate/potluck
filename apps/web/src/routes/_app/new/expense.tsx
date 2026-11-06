import { createFileRoute, useCanGoBack, useNavigate, useRouter } from '@tanstack/react-router'
import { t } from '@potluck/i18n'
import { ExpenseForm } from '@/features/expenses/form/expense-form'
import { GroupPicker } from '@/features/expenses/group-picker'
import { MoneyPageShell } from '@/features/expenses/money-page-shell'
import { validateNewExpenseSearch } from '@/features/expenses/search-params'

export const Route = createFileRoute('/_app/new/expense')({
  validateSearch: validateNewExpenseSearch,
  component: NewExpense,
})

function NewExpense() {
  const { groupId, eventId } = Route.useSearch()
  const navigate = useNavigate()
  const router = useRouter()
  // Only step back inside the app; a shared or typed link has nothing in-app to return to.
  const canGoBack = useCanGoBack()
  const close = () => {
    if (canGoBack) router.history.back()
    else if (groupId) void navigate({ to: '/groups/$groupId', params: { groupId } })
    else void navigate({ to: '/home' })
  }

  if (!groupId) {
    return (
      <MoneyPageShell title={t('expenses.form.newTitle')} onClose={close}>
        <div className="px-4 py-6 md:px-8">
          <GroupPicker
            title={t('expenses.pickGroup.title')}
            hint={t('expenses.pickGroup.hint')}
            onPick={(group) =>
              void navigate({
                to: '/new/expense',
                search: { groupId: group.id, eventId },
                replace: true,
              })
            }
          />
        </div>
      </MoneyPageShell>
    )
  }

  return (
    <ExpenseForm
      key={groupId}
      mode="create"
      groupId={groupId}
      eventId={eventId}
      onClose={close}
      onDone={() =>
        // Back to the plan the expense was filed under, so it shows up where it was added.
        eventId
          ? void navigate({ to: '/plans/$eventId', params: { eventId }, replace: true })
          : void navigate({ to: '/groups/$groupId', params: { groupId }, replace: true })
      }
    />
  )
}
