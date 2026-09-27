import {
  createContext,
  forwardRef,
  useContext,
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react'
import { cn } from './cn'

interface FieldIds {
  id: string
  describedBy: string | undefined
  invalid: boolean
}

const FieldContext = createContext<FieldIds | null>(null)

/** Ids and aria wiring for a control rendered inside a `Field`. */
export function useField(): FieldIds | null {
  return useContext(FieldContext)
}

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  /** Error message. Also marks the control invalid. */
  error?: ReactNode
  /** Hide the label visually (still announced). */
  hideLabel?: boolean
  /** Optional element on the label row, e.g. a "Max" button. */
  aside?: ReactNode
  id?: string
  className?: string
  children: ReactNode
}

/** Label, hint and error around one control, wired with aria attributes. */
export function Field({
  label,
  hint,
  error,
  hideLabel,
  aside,
  id,
  className,
  children,
}: FieldProps) {
  const auto = useId()
  const controlId = id ?? `f${auto}`
  const hintId = hint ? `${controlId}-hint` : undefined
  const errorId = error ? `${controlId}-error` : undefined
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined
  return (
    <FieldContext.Provider value={{ id: controlId, describedBy, invalid: !!error }}>
      <div className={cn('flex flex-col gap-1.5', className)}>
        <div className={cn('flex items-baseline justify-between gap-3', hideLabel && 'sr-only')}>
          <label htmlFor={controlId} className="text-sm font-semibold text-ink">
            {label}
          </label>
          {aside}
        </div>
        {children}
        {hint && !error && (
          <p id={hintId} className="text-xs text-mute">
            {hint}
          </p>
        )}
        {error && (
          <p id={errorId} className="text-xs font-medium text-tomato-ink">
            {error}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}

export const controlClassName =
  'w-full rounded-input border border-line-strong bg-card px-4 text-base text-ink placeholder:text-mute/80 ' +
  'transition-[border-color,background-color] duration-150 ease-out hover:border-ink/35 focus:border-ink ' +
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:opacity-60 ' +
  'aria-invalid:border-tomato aria-invalid:bg-tomato-soft/30'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  leading?: ReactNode
  trailing?: ReactNode
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { className, leading, trailing, id, ...props },
  ref,
) {
  const field = useField()
  const input = (
    <input
      ref={ref}
      id={id ?? field?.id}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cn(controlClassName, 'h-12', leading && 'pl-11', trailing && 'pr-11', className)}
      {...props}
    />
  )
  if (!leading && !trailing) return input
  return (
    <div className="relative">
      {leading && (
        <span className="pointer-events-none absolute inset-y-0 left-4 flex items-center text-mute [&_svg]:size-5">
          {leading}
        </span>
      )}
      {input}
      {trailing && (
        <span className="absolute inset-y-0 right-3 flex items-center text-mute [&_svg]:size-5">
          {trailing}
        </span>
      )}
    </div>
  )
})

export type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement>

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { className, id, rows = 3, ...props },
  ref,
) {
  const field = useField()
  return (
    <textarea
      ref={ref}
      id={id ?? field?.id}
      rows={rows}
      aria-describedby={field?.describedBy}
      aria-invalid={field?.invalid || undefined}
      className={cn(controlClassName, 'field-sizing-content min-h-24 resize-none py-3', className)}
      {...props}
    />
  )
})
