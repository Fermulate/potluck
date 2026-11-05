import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { ListRow } from './list-row'

describe('ListRow', () => {
  it('shows the title, subtitle and right column', () => {
    const ref = createRef<HTMLElement>()
    render(
      <ListRow
        ref={ref}
        data-testid="row"
        leading={<span>🍕</span>}
        title="Pizza night"
        subtitle="Ada paid"
        meta="€42.00"
        metaSub="you owe"
      />,
    )
    const row = screen.getByTestId('row')
    expect(row.tagName).toBe('DIV')
    expect(ref.current).toBe(row)
    expect(row).toHaveTextContent('🍕Pizza nightAda paid€42.00you owe')
  })

  it('shows only what it is given', () => {
    render(<ListRow data-testid="row" title="Groceries" metaSub="settled" />)
    expect(screen.getByTestId('row')).toHaveTextContent(/^Groceriessettled$/)
  })

  it('renders as the child link, with the row content inside it', async () => {
    const onClick = vi.fn()
    render(
      <ListRow asChild chevron title="Flat" subtitle="4 people" meta="+€10.00" onClick={onClick}>
        <a href="/groups/flat" />
      </ListRow>,
    )
    const link = screen.getByRole('link', { name: /Flat/ })
    expect(link).toHaveAttribute('href', '/groups/flat')
    expect(link).toHaveTextContent('Flat4 people+€10.00')
    expect(link.querySelector('svg')).toHaveAttribute('aria-hidden', 'true')
    await userEvent.click(link)
    expect(onClick).toHaveBeenCalledOnce()
  })
})
