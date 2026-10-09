import { springs } from '@potluck/tokens'
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { motion } from 'motion/react'
import { createContext, useContext, useId, type ComponentProps, type ReactNode } from 'react'
import { cn } from './cn'
import { usePrefersReducedMotion } from './hooks'

const TabsContext = createContext<{ value: string | undefined; indicatorId: string }>({
  value: undefined,
  indicatorId: '',
})

export interface TabsProps extends Omit<ComponentProps<typeof TabsPrimitive.Root>, 'value'> {
  /** Controlled value. Tabs must be controlled so the indicator can follow. */
  value: string
}

/** Underline tabs with a sliding ink bar. Arrow keys move between tabs. */
export function Tabs({ value, className, ...props }: TabsProps) {
  const indicatorId = useId()
  return (
    <TabsContext.Provider value={{ value, indicatorId }}>
      <TabsPrimitive.Root value={value} className={cn('flex flex-col', className)} {...props} />
    </TabsContext.Provider>
  )
}

export function TabsList({ className, ...props }: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      className={cn(
        'relative scrollbar-none flex gap-5 overflow-x-auto border-b border-line',
        className,
      )}
      {...props}
    />
  )
}

export interface TabsTriggerProps extends ComponentProps<typeof TabsPrimitive.Trigger> {
  value: string
  /** Small count after the label. */
  count?: ReactNode
}

export function TabsTrigger({ value, count, className, children, ...props }: TabsTriggerProps) {
  const ctx = useContext(TabsContext)
  const reduced = usePrefersReducedMotion()
  const active = ctx.value === value
  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        'relative -mb-px inline-flex h-11 shrink-0 items-center gap-1.5 text-[0.9375rem] font-semibold whitespace-nowrap transition-colors duration-150',
        'text-mute hover:text-ink data-[state=active]:text-ink',
        className,
      )}
      {...props}
    >
      {children}
      {count !== undefined && (
        <span className="rounded-pill bg-sunken px-1.5 text-xs leading-5 text-mute tabular">
          {count}
        </span>
      )}
      {active && (
        <motion.span
          layoutId={ctx.indicatorId}
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-[3px] rounded-t-full bg-tomato"
          transition={reduced ? { duration: 0 } : springs.snappy}
        />
      )}
    </TabsPrimitive.Trigger>
  )
}

export function TabsContent({ className, ...props }: ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn('pt-4 outline-none', className)} {...props} />
}
