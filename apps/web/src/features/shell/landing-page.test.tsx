import { t } from '@potluck/i18n'
import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { HeroDemo } from './hero-demo'
import { LandingPage } from './landing-page'

function preferReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: reduce && query.includes('reduce'),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  )
}

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('LandingPage', () => {
  it('pitches the app and points to sign up and sign in', async () => {
    renderWithProviders(<LandingPage />)
    expect(
      await screen.findByRole('heading', { level: 1, name: /^Split the bill\./ }),
    ).toBeInTheDocument()
    const ctas = screen.getAllByRole('link', { name: t('app.landing.cta') })
    expect(ctas).toHaveLength(2)
    for (const cta of ctas) expect(cta).toHaveAttribute('href', '/sign-up')
    expect(screen.getByRole('link', { name: t('app.landing.secondary') })).toHaveAttribute(
      'href',
      '/sign-in',
    )
    expect(
      screen.getByRole('heading', { name: t('app.landing.features.tab.title') }),
    ).toBeInTheDocument()
    // The demo loads after the headline and buttons have painted.
    expect(
      await screen.findByRole('figure', { name: t('app.landing.demo.label') }),
    ).toBeInTheDocument()
  })
})

describe('HeroDemo', () => {
  it('splits the bill, warms up the grid, then locks in a night', () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    render(<HeroDemo />)
    expect(screen.getByText(t('app.landing.demo.items.dumplings'))).toBeInTheDocument()
    expect(screen.queryByText(t('app.landing.demo.locked'))).not.toBeInTheDocument()
    expect(screen.queryAllByText('$37.20')).toHaveLength(0)

    act(() => vi.advanceTimersByTime(2400))
    // A quarter of the bill under each of the four friends.
    expect(screen.getAllByText('$37.20')).toHaveLength(4)

    act(() => vi.advanceTimersByTime(4900))
    expect(screen.getByText(t('app.landing.demo.locked'))).toBeInTheDocument()
    expect(screen.getByText(t('app.landing.demo.lockedWhen'))).toBeInTheDocument()
  })

  it('shows the finished table straight away with reduced motion', () => {
    preferReducedMotion(true)
    render(<HeroDemo />)
    expect(screen.getByText(t('app.landing.demo.locked'))).toBeInTheDocument()
  })
})
