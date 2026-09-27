import { Slot } from '@radix-ui/react-slot'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'
import { cn } from './cn'
import { LoadingDots } from './spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'ink'
export type ButtonSize = 'sm' | 'md' | 'lg'

const base =
  'relative inline-flex shrink-0 select-none items-center justify-center gap-2 rounded-pill font-semibold whitespace-nowrap ' +
  'transition-[transform,background-color,box-shadow,color,opacity] duration-150 ease-out ' +
  'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45 aria-busy:opacity-100'

const variants: Record<ButtonVariant, string> = {
  primary:
    'bg-tomato-strong text-on-tomato shadow-[inset_0_-2px_0_rgb(0_0_0/0.14)] hover:brightness-[1.06]',
  secondary: 'border border-line-strong bg-card text-ink hover:border-ink/40 hover:bg-sunken',
  ghost: 'text-ink hover:bg-ink/[0.06]',
  danger: 'border border-tomato/30 bg-tomato-soft text-tomato-ink hover:border-tomato/60',
  ink: 'bg-ink text-paper shadow-[inset_0_-2px_0_rgb(0_0_0/0.25)] hover:bg-ink/90',
}

const sizes: Record<ButtonSize, string> = {
  sm: 'h-9 px-4 text-sm',
  md: 'h-11 px-5 text-[0.9375rem]',
  lg: 'h-14 px-7 text-lg',
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Shows loading dots, keeps the width and accessible name, and disables the button. */
  loading?: boolean
  leadingIcon?: ReactNode
  trailingIcon?: ReactNode
  /** Stretch to the container width. */
  block?: boolean
  /** Render the child element (e.g. a router Link) with button styles. */
  asChild?: boolean
}

export function buttonClassName({
  variant = 'primary',
  size = 'md',
  block,
  className,
}: Pick<ButtonProps, 'variant' | 'size' | 'block' | 'className'> = {}): string {
  return cn(base, variants[variant], sizes[size], block && 'w-full', className)
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = 'primary',
    size = 'md',
    loading = false,
    leadingIcon,
    trailingIcon,
    block,
    asChild,
    className,
    type = 'button',
    disabled,
    children,
    ...props
  },
  ref,
) {
  const classes = buttonClassName({ variant, size, block, className })
  if (asChild) {
    return (
      <Slot ref={ref} className={classes} {...props}>
        {children}
      </Slot>
    )
  }
  return (
    <button
      ref={ref}
      type={type}
      className={classes}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      <span className={cn('inline-flex items-center gap-2', loading && 'opacity-0')}>
        {leadingIcon && (
          <span
            aria-hidden
            className="-ml-1 inline-flex size-[1.15em] items-center [&>svg]:size-full"
          >
            {leadingIcon}
          </span>
        )}
        {children}
        {trailingIcon && (
          <span
            aria-hidden
            className="-mr-1 inline-flex size-[1.15em] items-center [&>svg]:size-full"
          >
            {trailingIcon}
          </span>
        )}
      </span>
      {loading && (
        <span className="absolute inset-0 grid place-items-center">
          <LoadingDots size={size === 'lg' ? 22 : 18} />
        </span>
      )}
    </button>
  )
})

export interface IconButtonProps extends Omit<
  ButtonProps,
  'leadingIcon' | 'trailingIcon' | 'children' | 'block'
> {
  /** Required accessible name, e.g. "Close". */
  label: string
  icon: ReactNode
}

const iconSizes: Record<ButtonSize, string> = {
  sm: 'size-9 [&_svg]:size-4',
  md: 'size-11 [&_svg]:size-5',
  lg: 'size-14 [&_svg]:size-6',
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, variant = 'ghost', size = 'md', className, ...props },
  ref,
) {
  return (
    <Button
      ref={ref}
      variant={variant}
      size={size}
      aria-label={label}
      title={props.title ?? label}
      className={cn('px-0', iconSizes[size], className)}
      {...props}
    >
      <span aria-hidden className="contents">
        {icon}
      </span>
    </Button>
  )
})
