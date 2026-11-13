import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useMemo } from 'react'
import { ExpensesTab } from '@/features/expenses/expenses-tab'
import { rememberGroupFilters } from '@/features/insights/group-filters'
import {
  filtersFromSearch,
  searchFromFilters,
  validateGroupListSearch,
} from '@/features/insights/search-params'
import { prefetch } from '@/lib/prefetch'

export const Route = createFileRoute('/_app/groups/$groupId/')({
  // The list's filters live in this tab's address only (the tab link brings them back).
  validateSearch: validateGroupListSearch,
  loader: ({ context, params }) => prefetch.expenses(context.queryClient, params.groupId),
  component: GroupExpenses,
})

function GroupExpenses() {
  const { groupId } = Route.useParams()
  const search = Route.useSearch()
  const navigate = Route.useNavigate()
  const filters = useMemo(() => filtersFromSearch(search), [search])
  useEffect(() => rememberGroupFilters(groupId, search), [groupId, search])
  return (
    <ExpensesTab
      groupId={groupId}
      filters={filters}
      onFiltersChange={(next) =>
        void navigate({ search: searchFromFilters(next), replace: true, resetScroll: false })
      }
    />
  )
}
