import { meKeys, updateMyProfile, type ProfileRow } from '@potluck/api'
import { isLocale, LOCALE_CODES, LOCALES, t } from '@potluck/i18n'
import { Field, Select, toast } from '@potluck/ui'
import { useQueryClient } from '@tanstack/react-query'
import { applyLanguage, useLocale } from '@/lib/language'
import { supabase } from '@/lib/supabase'
import { accountError } from './account-error'

/**
 * Picks the app's language. It switches right away, then lands on the profile so it follows the
 * person to their other devices. Each language is named in itself, so anyone can find theirs.
 */
export function LanguageField({ userId }: { userId: string }) {
  const queryClient = useQueryClient()
  const locale = useLocale()

  async function choose(value: string) {
    if (!isLocale(value) || value === locale) return
    const key = meKeys.profile(userId)
    const previous = queryClient.getQueryData<ProfileRow>(key)
    queryClient.setQueryData<ProfileRow>(key, (p) => (p ? { ...p, locale: value } : p))
    await applyLanguage(value)
    try {
      queryClient.setQueryData(key, await updateMyProfile(supabase, userId, { locale: value }))
      toast.success(t('security.language.saved'))
    } catch (error) {
      // Not saved means it would not follow the person anywhere: go back to what was there.
      if (previous) queryClient.setQueryData(key, previous)
      await applyLanguage(locale)
      toast.error(accountError(error))
    }
  }

  return (
    <Field label={t('security.language.label')} hint={t('security.language.hint')}>
      <Select
        value={locale}
        onValueChange={(value) => void choose(value)}
        options={LOCALE_CODES.map((code) => ({
          value: code,
          label: <span lang={code}>{LOCALES[code].name}</span>,
          textValue: LOCALES[code].name,
        }))}
      />
    </Field>
  )
}
