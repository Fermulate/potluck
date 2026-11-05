import { t } from '@potluck/i18n'
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { docsOrigin, REPORT_PROBLEM_URL } from '@/lib/docs'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))

const { HelpSection } = await import('./me-page')

describe('Help on Me', () => {
  it('links to the guide pages people need most and to the issue tracker', () => {
    render(<HelpSection />)
    const section = within(screen.getByRole('region', { name: t('help.section.title') }))
    const link = (key: Parameters<typeof t>[0]) =>
      section.getByRole('link', { name: `${t(key)} (${t('help.newTab')})` })

    expect(link('help.section.gettingStarted')).toHaveAttribute(
      'href',
      `${docsOrigin()}/getting-started/`,
    )
    expect(link('help.section.faq')).toHaveAttribute('href', `${docsOrigin()}/faq/`)
    expect(link('help.section.troubleshooting')).toHaveAttribute(
      'href',
      `${docsOrigin()}/troubleshooting/`,
    )
    expect(link('help.section.guide')).toHaveAttribute('href', `${docsOrigin()}/`)
    expect(link('help.section.report')).toHaveAttribute('href', REPORT_PROBLEM_URL)
    for (const a of section.getAllByRole('link')) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener')
    }
  })
})
