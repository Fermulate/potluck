import { createFileRoute } from '@tanstack/react-router'
import { SearchScreen } from '@/features/insights/search-screen'
import { validateMoneySearch } from '@/features/insights/search-params'

export const Route = createFileRoute('/_app/search')({
  validateSearch: validateMoneySearch,
  component: SearchRoute,
})

function SearchRoute() {
  return <SearchScreen search={Route.useSearch()} />
}
