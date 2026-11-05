import * as CheckboxPrimitive from '@radix-ui/react-checkbox'
import * as SwitchPrimitive from '@radix-ui/react-switch'
import { Check, Minus } from 'lucide-react'
import { forwardRef, useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from './cn'

interface LabelledProps {
  /** Visible label. Clicking it toggles the control. */
  label?: ReactNode
  /** Secondary line under the label. */
  description?: ReactNode
}

function Labelled({
  id,
  label,
  description,
  control,
  reverse,
  className,
}: LabelledProps & { id: string; control: ReactNode; reverse?: boolean; className?: string }) {
  if (!label) return <>{control}</>
  return (
    <div
      className={cn(
        'flex items-start gap-3',
        reverse && 'flex-row-reverse justify-between',
        className,
      )}
    >
      <span className="pt-0.5">{control}</span>
      <span className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={id} className="text-[0.9375rem] font-medium text-ink">
          {label}
        </label>
        {description && (
          <span id={`${id}-desc`} className="text-sm text-mute">
            {description}
          </span>
        )}
      </span>
    </div>
  )
}

export type SwitchProps = ComponentProps<typeof SwitchPrimitive.Root> & LabelledProps

/** On/off toggle. With a `label`, the label sits on the left and the switch on the right. */
export const Switch = forwardRef<HTMLButtonElement, SwitchProps>(function Switch(
  { label, description, id, className, ...props },
  ref,
) {
  const auto = useId()
  const controlId = id ?? `s${auto}`
  return (
    <Labelled
      id={controlId}
      label={label}
      description={description}
      reverse
      className={className}
      control={
        <SwitchPrimitive.Root
          ref={ref}
          id={controlId}
          aria-describedby={description ? `${controlId}-desc` : undefined}
          className={cn(
            'group relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill p-0.5 transition-colors duration-200',
            'bg-line-strong disabled:opacity-45 data-[state=checked]:bg-olive',
            !label && className,
          )}
          {...props}
        >
          <SwitchPrimitive.Thumb className="block size-6 rounded-full bg-card shadow-[0_1px_3px_rgb(40_25_10/0.3)] transition-transform duration-200 ease-[cubic-bezier(0.34,1.56,0.64,1)] data-[state=checked]:translate-x-5" />
        </SwitchPrimitive.Root>
      }
    />
  )
})

export type CheckboxProps = ComponentProps<typeof CheckboxPrimitive.Root> & LabelledProps

export const Checkbox = forwardRef<HTMLButtonElement, CheckboxProps>(function Checkbox(
  { label, description, id, className, ...props },
  ref,
) {
  const auto = useId()
  const controlId = id ?? `c${auto}`
  return (
    <Labelled
      id={controlId}
      label={label}
      description={description}
      className={className}
      control={
        <CheckboxPrimitive.Root
          ref={ref}
          id={controlId}
          aria-describedby={description ? `${controlId}-desc` : undefined}
          className={cn(
            'grid size-[1.375rem] shrink-0 place-items-center rounded-[0.4375rem] border-[1.5px] border-line-strong bg-card text-paper transition-colors duration-150',
            'hover:border-ink/50 disabled:opacity-45 data-[state=checked]:border-ink data-[state=checked]:bg-ink data-[state=indeterminate]:border-ink data-[state=indeterminate]:bg-ink',
            !label && className,
          )}
          {...props}
        >
          <CheckboxPrimitive.Indicator className="group grid place-items-center">
            {props.checked === 'indeterminate' ? (
              <Minus aria-hidden className="size-3.5" strokeWidth={3.5} />
            ) : (
              <Check aria-hidden className="size-3.5" strokeWidth={3.5} />
            )}
          </CheckboxPrimitive.Indicator>
        </CheckboxPrimitive.Root>
      }
    />
  )
})
