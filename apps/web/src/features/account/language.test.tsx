import type * as AuthModule from '@/lib/auth'
import type { ProfileRow } from '@potluck/api'
import { currentLocale, en, setLocale, t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyLanguage, initialLocale, startLanguage, useLocale } from '@/lib/language'
import { argsOf, db, payloadOf, resetDb } from '@/test/supabase'
import { AboutSection } from './about-section'
import { LanguageField } from './language-field'
import { useProfileLanguage } from './use-profile-language'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))
vi.mock('@/lib/auth', async (importOriginal) => ({
  ...(await importOriginal<typeof AuthModule>()),
  useUserId: () => 'u-ava',
}))

Element.prototype.scrollIntoView ??= function scrollIntoView() {}
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}

const profile = { id: 'u-ava', display_name: 'Ava', locale: 'en' } as ProfileRow

function seedProfile(locale: string, { fail = false } = {}) {
  const fake = resetDb()
  let row = { ...profile, locale }
  fake.respond('from:profiles', (call) => {
    const patch = payloadOf(call, 'update') as Partial<ProfileRow> | undefined
    if (patch && fail) return { error: { message: 'Server error' } }
    if (patch) row = { ...row, ...patch }
    return { data: row }
  })
  return fake
}

function withClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  return { client, wrapper }
}

beforeEach(() => localStorage.clear())
afterEach(async () => {
  await setLocale('en')
  document.documentElement.lang = 'en'
})

describe('the starting language', () => {
  it('prefers the last choice on this device, then the browser, then English', () => {
    const language = vi.spyOn(navigator, 'language', 'get')
    language.mockReturnValue('es-MX')
    expect(initialLocale()).toBe('es')
    language.mockReturnValue('fr-FR')
    expect(initialLocale()).toBe('en')
    localStorage.setItem('potluck.locale', 'es')
    expect(initialLocale()).toBe('es')
    localStorage.setItem('potluck.locale', 'xx')
    expect(initialLocale()).toBe('en')
    language.mockRestore()
  })

  it('loads a remembered language before the first render', async () => {
    localStorage.setItem('potluck.locale', 'es')
    await startLanguage()
    expect(currentLocale()).toBe('es')
    expect(document.documentElement.lang).toBe('es')
  })

  it('needs no download for English', async () => {
    const language = vi.spyOn(navigator, 'language', 'get').mockReturnValue('en-GB')
    await startLanguage()
    expect(currentLocale()).toBe('en')
    language.mockRestore()
  })
})

describe('useLocale', () => {
  it('re-renders when the language changes', async () => {
    const { result } = renderHook(() => useLocale())
    expect(result.current).toBe('en')
    await act(() => applyLanguage('es'))
    expect(result.current).toBe('es')
    expect(localStorage.getItem('potluck.locale')).toBe('es')
  })
})

describe('LanguageField', () => {
  function renderField() {
    const { client, wrapper: Wrapper } = withClient()
    client.setQueryData(['potluck', 'me', 'profile', 'u-ava'], { ...profile })
    render(
      <Wrapper>
        <LanguageField userId="u-ava" />
        <Toaster label="Notifications" />
      </Wrapper>,
    )
    return client
  }

  // The listbox opens and picks from the keyboard; jsdom has no layout for pointer picks.
  async function pick(name: string) {
    fireEvent.keyDown(screen.getByRole('combobox', { name: t('security.language.label') }), {
      key: 'ArrowDown',
    })
    fireEvent.keyDown(await screen.findByRole('option', { name }), { key: 'Enter' })
  }

  it('switches at once and saves the choice on the profile', async () => {
    seedProfile('en')
    const client = renderField()
    expect(screen.getByRole('combobox')).toHaveTextContent('English')
    await pick('Español')
    await waitFor(() => expect(currentLocale()).toBe('es'))
    expect(await screen.findByText(t('security.language.saved'))).toBeInTheDocument()
    const update = db()
      .queries('profiles')
      .flatMap((call) => argsOf(call, 'update'))
    expect(update).toEqual([[{ locale: 'es' }]])
    expect(client.getQueryData<ProfileRow>(['potluck', 'me', 'profile', 'u-ava'])?.locale).toBe(
      'es',
    )
  })

  it('puts the profile back and says so when saving fails', async () => {
    seedProfile('en', { fail: true })
    const client = renderField()
    await pick('Español')
    expect(await screen.findByText(en.errors.generic)).toBeInTheDocument()
    expect(currentLocale()).toBe('en')
    expect(client.getQueryData<ProfileRow>(['potluck', 'me', 'profile', 'u-ava'])?.locale).toBe(
      'en',
    )
  })
})

describe('useProfileLanguage', () => {
  it('follows the language saved on the profile', async () => {
    seedProfile('es')
    const { wrapper } = withClient()
    renderHook(() => useProfileLanguage(), { wrapper })
    await waitFor(() => expect(currentLocale()).toBe('es'))
  })

  it('ignores a value it does not know', async () => {
    seedProfile('klingon')
    const { wrapper } = withClient()
    renderHook(() => useProfileLanguage(), { wrapper })
    await waitFor(() => expect(db().queries('profiles')).toHaveLength(1))
    expect(currentLocale()).toBe('en')
  })
})

describe('AboutSection', () => {
  it('names the build and links to the feedback form', () => {
    render(<AboutSection />)
    expect(
      screen.getByText(t('security.about.version', { version: __APP_VERSION__ })),
    ).toBeVisible()
    expect(
      screen.getByRole('link', { name: new RegExp(t('security.about.feedback')) }),
    ).toHaveAttribute('href', expect.stringContaining('feature_request'))
  })
})
