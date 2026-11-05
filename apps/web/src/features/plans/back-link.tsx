import { buttonClassName } from '@potluck/ui'
import { Link } from '@tanstack/react-router'
import { ChevronLeft } from 'lucide-react'

/** Round ghost back button that navigates to the plans list. */
export function BackToPlans({ label }: { label: string }) {
  return (
    <Link
      to="/plans"
      aria-label={label}
      title={label}
      className={buttonClassName({ variant: 'ghost', className: 'size-11 px-0 [&_svg]:size-5' })}
    >
      <ChevronLeft aria-hidden />
    </Link>
  )
}
