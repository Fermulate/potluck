import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { HelpLink, HelpTip } from './help'

describe('HelpLink', () => {
  it('opens the guide in a new tab and says so to screen readers', () => {
    render(
      <HelpLink
        href="https://guide.test/expenses/splits/#by-item"
        label="How by item works"
        newTabHint="opens in a new tab"
      />,
    )
    const link = screen.getByRole('link', { name: 'How by item works (opens in a new tab)' })
    expect(link).toHaveAttribute('href', 'https://guide.test/expenses/splits/#by-item')
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noopener')
  })

  it('can show its label inline', () => {
    render(<HelpLink href="/faq/" label="Questions" newTabHint="opens in a new tab" showLabel />)
    expect(screen.getByText('Questions')).toBeVisible()
    expect(screen.getByRole('link', { name: 'Questions (opens in a new tab)' })).toBeVisible()
  })
})

describe('HelpTip', () => {
  function renderTip() {
    return render(
      <>
        <HelpTip
          label="About simplified debts"
          title="Good to know"
          href="https://guide.test/balances/#simplified-debts"
          readMoreLabel="Read more"
          newTabHint="opens in a new tab"
        >
          Fewer payments, same totals.
        </HelpTip>
        <button type="button">Elsewhere</button>
      </>,
    )
  }

  it('starts closed and opens a short note with a link to the guide', async () => {
    const user = userEvent.setup()
    renderTip()
    const button = screen.getByRole('button', { name: 'About simplified debts' })
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Fewer payments, same totals.')).not.toBeVisible()

    await user.click(button)
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByRole('note', { name: 'Good to know' })).toBeVisible()
    expect(screen.getByText('Fewer payments, same totals.')).toBeVisible()
    const more = screen.getByRole('link', { name: 'Read more (opens in a new tab)' })
    expect(more).toHaveAttribute('href', 'https://guide.test/balances/#simplified-debts')
    expect(more).toHaveAttribute('target', '_blank')
  })

  it('closes on Escape and gives focus back to the button', async () => {
    const user = userEvent.setup()
    renderTip()
    const button = screen.getByRole('button', { name: 'About simplified debts' })
    await user.click(button)
    await user.tab()
    expect(screen.getByRole('link', { name: /Read more/ })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button).toHaveFocus()
  })
})
