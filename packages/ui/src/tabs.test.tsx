import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { describe, expect, it } from 'vitest'
import { Tabs, TabsContent, TabsList, TabsTrigger } from './tabs'

function Harness() {
  const [tab, setTab] = useState('expenses')
  return (
    <Tabs value={tab} onValueChange={setTab}>
      <TabsList aria-label="Group">
        <TabsTrigger value="expenses" count={12}>
          Expenses
        </TabsTrigger>
        <TabsTrigger value="balances">Balances</TabsTrigger>
        <TabsTrigger value="plans" count={0}>
          Plans
        </TabsTrigger>
      </TabsList>
      <TabsContent value="expenses">Expense list</TabsContent>
      <TabsContent value="balances">Balance list</TabsContent>
      <TabsContent value="plans">Plan list</TabsContent>
    </Tabs>
  )
}

describe('Tabs', () => {
  it('is a labelled tab list with the selected panel shown', () => {
    render(<Harness />)
    expect(screen.getByRole('tablist', { name: 'Group' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /^Expenses ?12$/ })).toHaveAttribute(
      'aria-selected',
      'true',
    )
    expect(screen.getByRole('tab', { name: 'Balances' })).toHaveAttribute('aria-selected', 'false')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Expense list')
  })

  it('shows a zero count but no count when none is given', () => {
    render(<Harness />)
    expect(screen.getByRole('tab', { name: /^Plans ?0$/ })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: 'Balances' })).toHaveTextContent(/^Balances$/)
  })

  it('switches panels on click', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('tab', { name: 'Balances' }))
    expect(screen.getByRole('tab', { name: 'Balances' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Balance list')
  })

  it('moves between tabs with the arrow keys', async () => {
    render(<Harness />)
    await userEvent.click(screen.getByRole('tab', { name: /^Expenses ?12$/ }))
    await userEvent.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Balances' })).toHaveFocus()
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Balance list')
    await userEvent.keyboard('{ArrowLeft}{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /^Plans ?0$/ })).toHaveFocus()
  })
})
