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
    const link = (name: string) =>
      section.getByRole('link', { name: `${name} (${t('help.newTab')})` })

    expect(link(t('help.section.gettingStarted'))).toHaveAttribute(
      'href',
      `${docsOrigin()}/getting-started/`,
    )
    expect(link(t('help.section.faq'))).toHaveAttribute('href', `${docsOrigin()}/faq/`)
    expect(link(t('help.section.troubleshooting'))).toHaveAttribute(
      'href',
      `${docsOrigin()}/troubleshooting/`,
    )
    expect(link(t('help.section.guide'))).toHaveAttribute('href', `${docsOrigin()}/`)
    expect(link(t('help.section.report'))).toHaveAttribute('href', REPORT_PROBLEM_URL)
    for (const a of section.getAllByRole('link')) {
      expect(a).toHaveAttribute('target', '_blank')
      expect(a).toHaveAttribute('rel', 'noopener')
    }
  })
})
