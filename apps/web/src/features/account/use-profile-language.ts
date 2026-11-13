import { currentLocale, isLocale } from '@potluck/i18n'
import { useEffect } from 'react'
import { applyLanguage } from '@/lib/language'
import { useMyProfile } from '@/lib/queries'

/**
 * The profile's language wins once it loads, so a choice made on one device follows the person
 * to every other one (and survives signing out and back in).
 */
export function useProfileLanguage() {
  const { data: profile } = useMyProfile()
  const saved = profile?.locale
  useEffect(() => {
    if (isLocale(saved) && saved !== currentLocale()) void applyLanguage(saved)
  }, [saved])
}
