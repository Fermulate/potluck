import { Input, type InputProps } from '@potluck/ui'
import { forwardRef } from 'react'

export interface CodeInputProps extends Omit<InputProps, 'value' | 'onChange'> {
  value: string
  onValueChange: (value: string) => void
}

/** The six digits from an authenticator app: numeric keypad, OTP autofill, big and spaced. */
export const CodeInput = forwardRef<HTMLInputElement, CodeInputProps>(function CodeInput(
  { value, onValueChange, ...props },
  ref,
) {
  return (
    <Input
      ref={ref}
      inputMode="numeric"
      autoComplete="one-time-code"
      pattern="[0-9]*"
      maxLength={6}
      spellCheck={false}
      value={value}
      onChange={(e) => onValueChange(e.target.value.replace(/\D/g, '').slice(0, 6))}
      className="h-14 text-center text-2xl font-extrabold tracking-[0.45em] tabular-nums"
      {...props}
    />
  )
})
