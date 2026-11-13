import { t } from '@potluck/i18n'
import { buttonClassName, cn } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { Search } from 'lucide-react'

/** A round search button for screen headers. */
export function SearchIconLink({ className }: { className?: string }) {
  const label = t('search.open')
  return (
    <Link
      to="/search"
      aria-label={label}
      title={label}
      className={cn(
        buttonClassName({ variant: 'secondary' }),
        'size-11 px-0 [&_svg]:size-5',
        className,
      )}
    >
      <Search aria-hidden />
    </Link>
  )
}
