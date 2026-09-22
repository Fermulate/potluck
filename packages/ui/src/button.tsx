import type { ComponentProps } from 'react'
import { cn } from './cn'

export function Button({ className, type = 'button', ...props }: ComponentProps<'button'>) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex items-center justify-center rounded-md px-4 py-2 font-medium disabled:opacity-50',
        className,
      )}
      {...props}
    />
  )
}
