import * as SelectPrimitive from '@radix-ui/react-select'
import { Check, ChevronDown } from 'lucide-react'
import { forwardRef, type ReactNode } from 'react'
import { cn } from './cn'
import { controlClassName, useField } from './field'

export interface SelectOption {
  value: string
  label: ReactNode
  /** Plain text for type-ahead when `label` is not a string. */
  textValue?: string
  icon?: ReactNode
  disabled?: boolean
}

export interface SelectProps {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: ReactNode
  /** Accessible name when not inside a `Field`. */
  label?: string
  disabled?: boolean
  name?: string
  className?: string
}

/** Single choice from a short list. Full keyboard support and type-ahead. */
export const Select = forwardRef<HTMLButtonElement, SelectProps>(function Select(
  { options, value, defaultValue, onValueChange, placeholder, label, disabled, name, className },
  ref,
) {
  const field = useField()
  return (
    <SelectPrimitive.Root
      value={value}
      defaultValue={defaultValue}
      onValueChange={onValueChange}
      disabled={disabled}
      name={name}
    >
      <SelectPrimitive.Trigger
        ref={ref}
        id={field?.id}
        aria-label={field ? undefined : label}
        aria-describedby={field?.describedBy}
        aria-invalid={field?.invalid || undefined}
        className={cn(
          controlClassName,
          'flex h-12 items-center justify-between gap-2 text-left data-[placeholder]:text-mute',
          className,
        )}
      >
        <SelectPrimitive.Value placeholder={placeholder} />
        <SelectPrimitive.Icon asChild>
          <ChevronDown aria-hidden className="size-4 shrink-0 text-mute" />
        </SelectPrimitive.Icon>
      </SelectPrimitive.Trigger>
      <SelectPrimitive.Portal>
        <SelectPrimitive.Content
          position="popper"
          sideOffset={6}
          className="z-60 max-h-[min(var(--radix-select-content-available-height),22rem)] min-w-[var(--radix-select-trigger-width)] overflow-hidden rounded-card border border-line bg-card text-ink shadow-pop data-[state=open]:animate-fade-in"
        >
          <SelectPrimitive.Viewport className="p-1.5">
            {options.map((option) => (
              <SelectPrimitive.Item
                key={option.value}
                value={option.value}
                textValue={
                  option.textValue ?? (typeof option.label === 'string' ? option.label : undefined)
                }
                disabled={option.disabled}
                className="relative flex h-11 cursor-pointer items-center gap-2.5 rounded-[0.625rem] pr-9 pl-3 text-[0.9375rem] outline-none select-none data-[disabled]:opacity-40 data-[highlighted]:bg-sunken data-[state=checked]:font-semibold"
              >
                {option.icon && (
                  <span aria-hidden className="inline-flex [&_svg]:size-4">
                    {option.icon}
                  </span>
                )}
                <SelectPrimitive.ItemText>{option.label}</SelectPrimitive.ItemText>
                <SelectPrimitive.ItemIndicator className="absolute right-3 inline-flex">
                  <Check aria-hidden className="size-4 text-tomato-ink" strokeWidth={3} />
                </SelectPrimitive.ItemIndicator>
              </SelectPrimitive.Item>
            ))}
          </SelectPrimitive.Viewport>
        </SelectPrimitive.Content>
      </SelectPrimitive.Portal>
    </SelectPrimitive.Root>
  )
})
