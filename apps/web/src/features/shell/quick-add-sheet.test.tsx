import { t } from '@potluck/i18n'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { QuickAddSheet } from './quick-add-sheet'

describe('QuickAddSheet', () => {
  it('offers the three ways to add something', async () => {
    renderWithProviders(<QuickAddSheet open onOpenChange={() => {}} />)
    expect(await screen.findByRole('dialog', { name: 'What are we doing?' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Add expense/ })).toHaveAttribute(
      'href',
      '/new/expense',
    )
    expect(screen.getByRole('link', { name: /Plan something/ })).toHaveAttribute(
      'href',
      '/new/plan',
    )
    expect(screen.getByRole('link', { name: /Settle up/ })).toHaveAttribute('href', '/new/settle')
  })

  it('carries the current group along', async () => {
    renderWithProviders(<QuickAddSheet open onOpenChange={() => {}} groupId="g-hike" />)
    expect(await screen.findByRole('link', { name: /Add expense/ })).toHaveAttribute(
      'href',
      '/new/expense?groupId=g-hike',
    )
    expect(screen.getByRole('link', { name: /Settle up/ })).toHaveAttribute(
      'href',
      '/new/settle?groupId=g-hike',
    )
  })

  it('turns Add expense off with the reason in a tab that takes no new expenses', async () => {
    const note = t('errors.codes.not_a_friend')
    renderWithProviders(
      <QuickAddSheet open onOpenChange={() => {}} groupId="g-tab" expenseNote={note} />,
    )
    const expense = await screen.findByRole('link', { name: /Add expense/ })
    expect(expense).toHaveAttribute('aria-disabled', 'true')
    expect(expense).not.toHaveAttribute('href')
    expect(expense).toHaveTextContent(note)
    // Settling up is how the two square up, so it stays.
    expect(screen.getByRole('link', { name: /Settle up/ })).toHaveAttribute(
      'href',
      '/new/settle?groupId=g-tab',
    )
  })
})
