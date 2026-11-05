import { Toaster as SonnerToaster, toast, type ToasterProps as SonnerToasterProps } from 'sonner'

export { toast }

export interface ToasterProps extends Omit<SonnerToasterProps, 'containerAriaLabel'> {
  /** Accessible name of the notifications region, e.g. "Notifications". */
  label: string
}

/**
 * Sonner, dressed in Potluck tokens. Mount once near the root. Pass the
 * resolved theme so the toasts match the app.
 */
export function Toaster({ label, theme = 'light', ...props }: ToasterProps) {
  return (
    <SonnerToaster
      containerAriaLabel={label}
      theme={theme}
      position="top-center"
      gap={8}
      offset={16}
      mobileOffset={12}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            'group flex w-full items-center gap-3 rounded-pill border border-line bg-ink py-2.5 pr-2.5 pl-4 text-paper shadow-pop font-sans text-[0.9375rem] font-medium',
          title: 'font-semibold leading-tight',
          description: 'text-sm text-paper/70',
          icon: 'shrink-0 [&_svg]:size-5',
          success: '[&_[data-icon]]:text-hero-olive',
          error: '[&_[data-icon]]:text-hero-tomato',
          warning: '[&_[data-icon]]:text-hero-saffron',
          info: '[&_[data-icon]]:text-hero-saffron',
          actionButton:
            'ml-auto shrink-0 rounded-pill bg-paper px-3 py-1.5 text-sm font-semibold text-ink',
          cancelButton: 'ml-auto shrink-0 rounded-pill px-3 py-1.5 text-sm text-paper/80',
          closeButton: 'text-paper/70',
        },
      }}
      {...props}
    />
  )
}
