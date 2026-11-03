import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { describe, expect, it } from 'vitest'
import { Card } from './card'
import { EmptyState } from './empty-state'
import { PageHeader } from './page-header'
import { Skeleton } from './skeleton'

describe('Card', () => {
  it('renders a div with its content and forwards the ref', () => {
    const ref = createRef<HTMLDivElement>()
    render(
      <Card ref={ref} tone="sunken" padding="roomy" aria-label="Summary" role="region">
        Totals
      </Card>,
    )
    const card = screen.getByRole('region', { name: 'Summary' })
    expect(card.tagName).toBe('DIV')
    expect(card).toHaveTextContent('Totals')
    expect(ref.current).toBe(card)
  })

  it('becomes its child with asChild, keeping the child semantics', () => {
    const { container } = render(
      <Card asChild interactive tone="hero" padding="none">
        <a href="/groups/1">Flat</a>
      </Card>,
    )
    const link = screen.getByRole('link', { name: 'Flat' })
    expect(link).toHaveAttribute('href', '/groups/1')
    expect(container.firstChild).toBe(link)
  })
})

describe('EmptyState', () => {
  it('shows a heading, description and the next step', () => {
    render(
      <EmptyState
        title="Nobody owes anybody."
        description="Add an expense to get started."
        illustration="🍲"
        action={<button type="button">Add expense</button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 2, name: 'Nobody owes anybody.' })).toBeVisible()
    expect(screen.getByText('Add an expense to get started.')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add expense' })).toBeInTheDocument()
    expect(screen.getByText('🍲')).toHaveAttribute('aria-hidden', 'true')
  })

  it('can use an h3 and leave out the optional parts', () => {
    const { container } = render(<EmptyState as="h3" align="start" title="No plans yet" />)
    expect(screen.getByRole('heading', { level: 3, name: 'No plans yet' })).toBeInTheDocument()
    expect(container.querySelector('p')).toBeNull()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})

describe('PageHeader', () => {
  it('is a banner with the title as the page heading', () => {
    render(
      <PageHeader
        title="Groups"
        flourish="Good evening"
        subtitle="3 open balances"
        actions={<button type="button">Search</button>}
      />,
    )
    expect(screen.getByRole('heading', { level: 1, name: 'Groups' })).toBeInTheDocument()
    expect(screen.getByText('Good evening')).toBeInTheDocument()
    expect(screen.getByText('3 open balances')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Search' })).toHaveLength(1)
  })

  it('puts actions in the top bar next to the back button when compact', () => {
    render(
      <PageHeader
        size="compact"
        title="Dinner"
        leading={<button type="button">Back</button>}
        actions={<button type="button">Edit</button>}
      />,
    )
    const back = screen.getByRole('button', { name: 'Back' })
    const edit = screen.getByRole('button', { name: 'Edit' })
    const heading = screen.getByRole('heading', { level: 1, name: 'Dinner' })
    expect(back.compareDocumentPosition(edit) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(edit.compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('renders just the title when nothing else is given', () => {
    render(<PageHeader title="Plans" />)
    const header = screen.getByRole('banner')
    expect(header).toHaveTextContent(/^Plans$/)
  })
})

describe('Skeleton', () => {
  it('is hidden from assistive tech and accepts props', () => {
    render(
      <div aria-busy="true" aria-label="Loading groups">
        <Skeleton shape="line" data-testid="line" />
        <Skeleton data-testid="block" style={{ height: 40 }} />
      </div>,
    )
    expect(screen.getByTestId('line')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByTestId('block')).toHaveStyle({ height: '40px' })
  })
})
