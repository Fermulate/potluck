import * as DropdownPrimitive from '@radix-ui/react-dropdown-menu'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from './cn'

const floating =
  'z-60 rounded-card border border-line bg-card text-ink shadow-pop data-[state=open]:animate-fade-in'

/* Tooltip */

export const TooltipProvider = TooltipPrimitive.Provider

export interface TooltipProps {
  content: ReactNode
  children: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
}

/** Short hint on hover and focus. Never put essential information in one. */
export function Tooltip({ content, children, side = 'top' }: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={350}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-80 rounded-pill bg-ink px-2.5 py-1 text-xs font-semibold text-paper data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}

/* Popover */

export const Popover = PopoverPrimitive.Root
export const PopoverTrigger = PopoverPrimitive.Trigger
export const PopoverClose = PopoverPrimitive.Close

export function PopoverContent({
  className,
  sideOffset = 8,
  ...props
}: ComponentProps<typeof PopoverPrimitive.Content>) {
  return (
    <PopoverPrimitive.Portal>
      <PopoverPrimitive.Content
        sideOffset={sideOffset}
        className={cn(floating, 'w-72 p-4 outline-none', className)}
        {...props}
      />
    </PopoverPrimitive.Portal>
  )
}

/* Menu */

export const Menu = DropdownPrimitive.Root
export const MenuTrigger = DropdownPrimitive.Trigger

export function MenuContent({
  className,
  sideOffset = 6,
  align = 'end',
  ...props
}: ComponentProps<typeof DropdownPrimitive.Content>) {
  return (
    <DropdownPrimitive.Portal>
      <DropdownPrimitive.Content
        sideOffset={sideOffset}
        align={align}
        className={cn(floating, 'min-w-48 p-1.5', className)}
        {...props}
      />
    </DropdownPrimitive.Portal>
  )
}

export interface MenuItemProps extends ComponentProps<typeof DropdownPrimitive.Item> {
  icon?: ReactNode
  tone?: 'default' | 'danger'
}

export function MenuItem({ icon, tone = 'default', className, children, ...props }: MenuItemProps) {
  return (
    <DropdownPrimitive.Item
      className={cn(
        'flex h-10 cursor-pointer items-center gap-2.5 rounded-[0.625rem] px-3 text-[0.9375rem] font-medium outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-sunken [&_svg]:size-4',
        tone === 'danger' ? 'text-tomato-ink' : 'text-ink',
        className,
      )}
      {...props}
    >
      {icon && (
        <span aria-hidden className="inline-flex text-current opacity-80">
          {icon}
        </span>
      )}
      {children}
    </DropdownPrimitive.Item>
  )
}

export function MenuSeparator({ className }: { className?: string }) {
  return <DropdownPrimitive.Separator className={cn('my-1 h-px bg-line', className)} />
}
