import { t } from '@potluck/i18n'
import { cn, Field, Input } from '@potluck/ui'
import { Check } from 'lucide-react'
import { useId } from 'react'
import { GROUP_COLORS, normalizeGroupColor, type GroupColor } from '@/lib/group-colors'

export const GROUP_EMOJIS = [
  '🍲', '🍕', '🌮', '🥟', '🍜', '🍣', '🍷', '🍻', '☕', '🧁',
  '🏠', '🏕️', '🥾', '✈️', '🏖️', '🚗', '🎉', '🎳', '⚽', '🎲',
  '🎬', '🎶', '💼', '🐶',
] as const

/** Emoji grid as a radio group, plus a free text box for anything else. */
export function EmojiPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (emoji: string) => void
}) {
  const name = useId()
  const custom = !(GROUP_EMOJIS as readonly string[]).includes(value)
  return (
    <fieldset className="grid gap-2">
      <legend className="mb-1.5 text-sm font-semibold">{t('groups.create.emojiLabel')}</legend>
      <div className="grid grid-cols-8 gap-1.5 sm:grid-cols-12">
        {GROUP_EMOJIS.map((emoji) => (
          <label
            key={emoji}
            className={cn(
              'grid aspect-square cursor-pointer place-items-center rounded-[0.75rem] text-2xl transition-[transform,background-color] duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              value === emoji ? 'scale-110 bg-saffron-soft ring-2 ring-saffron' : 'hover:bg-sunken',
            )}
          >
            <input
              type="radio"
              name={name}
              value={emoji}
              checked={value === emoji}
              onChange={() => onChange(emoji)}
              className="sr-only"
            />
            <span aria-hidden>{emoji}</span>
            <span className="sr-only">{emoji}</span>
          </label>
        ))}
      </div>
      <Field label={t('groups.emojiPicker.custom')} className="mt-1">
        <Input
          value={custom ? value : ''}
          maxLength={8}
          onChange={(e) => {
            const next = Array.from(e.target.value.trim()).slice(0, 2).join('')
            onChange(next || GROUP_EMOJIS[0])
          }}
          className="w-24 text-center text-xl"
        />
      </Field>
    </fieldset>
  )
}

const swatch: Record<GroupColor, string> = {
  tomato: 'bg-tomato',
  saffron: 'bg-saffron',
  olive: 'bg-olive',
  plum: 'bg-plum',
  sea: 'bg-[#2f5d6b]',
  ink: 'bg-ink',
}

export function ColorPicker({
  value,
  onChange,
}: {
  value: string
  onChange: (color: GroupColor) => void
}) {
  const name = useId()
  const current = normalizeGroupColor(value)
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold">{t('groups.create.colorLabel')}</legend>
      <div className="flex flex-wrap gap-3">
        {GROUP_COLORS.map((color) => (
          <label
            key={color}
            className={cn(
              'relative grid size-11 cursor-pointer place-items-center rounded-full transition-transform duration-150 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus',
              swatch[color],
              current === color ? 'scale-110 ring-2 ring-ink ring-offset-2 ring-offset-card' : 'hover:scale-105',
            )}
          >
            <input
              type="radio"
              name={name}
              value={color}
              checked={current === color}
              onChange={() => onChange(color)}
              className="sr-only"
            />
            <span className="sr-only">{t(`groups.colors.${color}`)}</span>
            {current === color && (
              <Check aria-hidden className="size-5 text-white mix-blend-difference" strokeWidth={3} />
            )}
          </label>
        ))}
      </div>
    </fieldset>
  )
}
