import { CATEGORY_IDS } from '@potluck/core'
import { t } from '@potluck/i18n'
import {
  Avatar,
  Button,
  Chip,
  cn,
  IconButton,
  Input,
  SegmentedControl,
  Select,
  Sheet,
  SheetContent,
} from '@potluck/ui'
import { SlidersHorizontal, X } from 'lucide-react'
import { useId, type ReactNode } from 'react'
import { categoryEmoji, categoryLabel } from '@/features/expenses/format'
import { avatarSrc } from '@/lib/queries'
import {
  countFilters,
  matchingPreset,
  presetRange,
  type ActiveFilter,
  type DatePreset,
  type MoneyFilters,
} from './filter-state'

export interface FilterPerson {
  id: string
  name: string
  avatarPath?: string | null
}

export interface FilterGroup {
  id: string
  name: string
  emoji?: string | null
}

/** Round "Filters" button with a count of what is on. */
export function FilterButton({
  filters,
  onClick,
  className,
}: {
  filters: MoneyFilters
  onClick: () => void
  className?: string
}) {
  const count = countFilters(filters)
  return (
    <span className={cn('relative inline-flex shrink-0', className)}>
      <IconButton
        label={count ? t('filters.openActive', { count }) : t('filters.open')}
        icon={<SlidersHorizontal />}
        variant={count ? 'ink' : 'secondary'}
        aria-haspopup="dialog"
        onClick={onClick}
      />
      {count > 0 && (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-1 -right-1 grid min-w-5 place-items-center rounded-pill bg-tomato px-1 text-[0.6875rem] leading-5 font-bold text-on-tomato tabular-nums ring-2 ring-paper"
        >
          {count}
        </span>
      )}
    </span>
  )
}

/** The filters that are on, as chips that remove themselves when pressed. */
export function ActiveFilterChips({
  chips,
  onRemove,
  className,
}: {
  chips: ActiveFilter[]
  onRemove: (chip: ActiveFilter) => void
  className?: string
}) {
  if (chips.length === 0) return null
  return (
    <ul
      aria-label={t('filters.title')}
      className={cn(
        '-mx-4 flex [scrollbar-width:none] gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-wrap lg:px-0',
        className,
      )}
    >
      {chips.map((chip) => (
        <li key={`${chip.key}:${chip.value ?? ''}`}>
          <Chip
            selected
            aria-pressed={undefined}
            aria-label={t('filters.remove', { filter: chip.label })}
            onClick={() => onRemove(chip)}
          >
            {chip.label}
            <X aria-hidden className="-mr-1" />
          </Chip>
        </li>
      ))}
    </ul>
  )
}

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  const id = useId()
  return (
    <section
      aria-labelledby={id}
      className="flex flex-col gap-2.5 border-t border-line pt-4 first:border-t-0 first:pt-1"
    >
      <div>
        <h3 id={id} className="text-[0.9375rem] font-bold tracking-tight">
          {title}
        </h3>
        {hint && <p className="text-sm text-mute">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Every filter in one sheet: when, who, category, and (for search) group and type. Changes apply
 * as they are made, so the list behind the sheet is already filtered when it closes.
 */
export function FilterSheet({
  open,
  onOpenChange,
  filters,
  onChange,
  today,
  people,
  groups,
  categories = CATEGORY_IDS,
  showKind = false,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  filters: MoneyFilters
  onChange: (next: MoneyFilters) => void
  /** `YYYY-MM-DD` in the viewer's zone, for the date presets. */
  today: string
  people: FilterPerson[]
  /** Offer a group filter (search). */
  groups?: FilterGroup[]
  categories?: readonly string[]
  showKind?: boolean
}) {
  const preset = matchingPreset(filters, today)
  const custom = !preset && Boolean(filters.from || filters.to)
  const set = (patch: Partial<MoneyFilters>) => onChange({ ...filters, ...patch })
  const setPreset = (next: DatePreset | null) =>
    set(next ? presetRange(next, today) : { from: null, to: null })
  const selectedCategories = filters.categories ?? []
  const toggleCategory = (c: string) =>
    set({
      categories: selectedCategories.includes(c)
        ? selectedCategories.filter((x) => x !== c)
        : [...selectedCategories, c],
    })

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        title={t('filters.title')}
        closeLabel={t('common.close')}
        footer={
          <div className="flex items-center justify-between gap-3">
            <Button
              variant="ghost"
              disabled={countFilters(filters) === 0}
              onClick={() =>
                onChange({
                  from: null,
                  to: null,
                  person: null,
                  categories: [],
                  groupId: null,
                  kind: null,
                })
              }
            >
              {t('filters.clearAll')}
            </Button>
            <Button onClick={() => onOpenChange(false)}>{t('filters.done')}</Button>
          </div>
        }
      >
        <div className="flex flex-col gap-4">
          <Section title={t('filters.when')}>
            <div role="group" aria-label={t('filters.when')} className="flex flex-wrap gap-2">
              <Chip selected={!filters.from && !filters.to} onClick={() => setPreset(null)}>
                {t('filters.anyTime')}
              </Chip>
              {(['thisMonth', 'lastMonth', 'thisYear'] as const).map((p) => (
                <Chip key={p} selected={preset === p} onClick={() => setPreset(p)}>
                  {t(`filters.${p}`)}
                </Chip>
              ))}
              <Chip
                selected={custom}
                onClick={() =>
                  set({
                    from: filters.from ?? presetRange('thisMonth', today).from,
                    to: filters.to ?? today,
                  })
                }
              >
                {t('filters.custom')}
              </Chip>
            </div>
            {custom && (
              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  {t('filters.from')}
                  <Input
                    type="date"
                    value={filters.from ?? ''}
                    max={filters.to ?? undefined}
                    onChange={(e) => set({ from: e.target.value || null })}
                  />
                </label>
                <label className="flex flex-col gap-1 text-sm font-semibold">
                  {t('filters.to')}
                  <Input
                    type="date"
                    value={filters.to ?? ''}
                    min={filters.from ?? undefined}
                    onChange={(e) => set({ to: e.target.value || null })}
                  />
                </label>
              </div>
            )}
          </Section>

          {people.length > 0 && (
            <Section title={t('filters.who')} hint={t('filters.whoHint')}>
              <div role="group" aria-label={t('filters.who')} className="flex flex-wrap gap-2">
                <Chip selected={!filters.person} onClick={() => set({ person: null })}>
                  {t('filters.anyone')}
                </Chip>
                {people.map((p) => (
                  <Chip
                    key={p.id}
                    selected={filters.person === p.id}
                    onClick={() => set({ person: filters.person === p.id ? null : p.id })}
                    className="pl-1.5"
                    icon={
                      <Avatar name={p.name} seed={p.id} src={avatarSrc(p.avatarPath)} size="xs" />
                    }
                  >
                    {p.name}
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          {filters.kind !== 'payment' && (
            <Section title={t('filters.category')}>
              <div role="group" aria-label={t('filters.category')} className="flex flex-wrap gap-2">
                <Chip
                  selected={selectedCategories.length === 0}
                  onClick={() => set({ categories: [] })}
                >
                  {t('filters.anyCategory')}
                </Chip>
                {categories.map((c) => (
                  <Chip
                    key={c}
                    selected={selectedCategories.includes(c)}
                    onClick={() => toggleCategory(c)}
                    icon={<span className="text-base leading-none">{categoryEmoji(c)}</span>}
                  >
                    {categoryLabel(c)}
                  </Chip>
                ))}
              </div>
            </Section>
          )}

          {groups && groups.length > 1 && (
            <Section title={t('filters.group')}>
              <Select
                label={t('filters.group')}
                value={filters.groupId ?? 'all'}
                onValueChange={(v) => set({ groupId: v === 'all' ? null : v })}
                options={[
                  { value: 'all', label: t('filters.anyGroup') },
                  ...groups.map((g) => ({
                    value: g.id,
                    label: g.name,
                    icon: g.emoji ? (
                      <span className="text-base leading-none">{g.emoji}</span>
                    ) : undefined,
                  })),
                ]}
              />
            </Section>
          )}

          {showKind && (
            <Section title={t('filters.type')}>
              <SegmentedControl
                label={t('filters.type')}
                block
                value={filters.kind ?? 'all'}
                onValueChange={(v) =>
                  set(
                    v === 'all'
                      ? { kind: null }
                      : v === 'payment'
                        ? { kind: 'payment', categories: [] }
                        : { kind: 'expense' },
                  )
                }
                options={[
                  { value: 'all', label: t('filters.allTypes') },
                  { value: 'expense', label: t('filters.expenses') },
                  { value: 'payment', label: t('filters.payments') },
                ]}
              />
            </Section>
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}
