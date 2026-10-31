import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createRef } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AddButton, BottomTabBar, SideRail, type NavItem, type RenderNavLink } from './nav'

const items: NavItem[] = [
  {
    id: 'home',
    label: 'Home',
    href: '/',
    icon: <svg data-testid="home-outline" />,
    activeIcon: <svg data-testid="home-filled" />,
  },
  { id: 'groups', label: 'Groups', href: '/groups', icon: <svg />, badge: 3 },
  { id: 'plans', label: 'Plans', href: '/plans', icon: <svg />, badge: true },
  { id: 'me', label: 'Me', href: '/me', icon: <svg data-testid="me-outline" />, badge: 0 },
]

describe('BottomTabBar', () => {
  it('is a labelled nav of links with the active one marked as the current page', () => {
    render(<BottomTabBar label="Main" items={items} activeId="home" />)
    const nav = screen.getByRole('navigation', { name: 'Main' })
    const links = within(nav).getAllByRole('link')
    expect(links.map((l) => l.getAttribute('href'))).toEqual(['/', '/groups', '/plans', '/me'])
    expect(within(nav).getByRole('link', { name: 'Home' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Plans' })).not.toHaveAttribute('aria-current')
  })

  it('uses the active icon only for the active item', () => {
    render(<BottomTabBar label="Main" items={items} activeId="home" />)
    expect(screen.getByTestId('home-filled')).toBeInTheDocument()
    expect(screen.queryByTestId('home-outline')).not.toBeInTheDocument()
    expect(screen.getByTestId('me-outline')).toBeInTheDocument()
  })

  it('falls back to the outline icon when there is no active icon', () => {
    render(<BottomTabBar label="Main" items={items} activeId="me" />)
    expect(screen.getByTestId('me-outline')).toBeInTheDocument()
    expect(screen.getByTestId('home-outline')).toBeInTheDocument()
  })

  it('reads numeric badges in the link name and caps the visible count', () => {
    const many = items.map((i) => (i.id === 'groups' ? { ...i, badge: 120 } : i))
    render(<BottomTabBar label="Main" items={many} activeId="home" />)
    expect(screen.getByRole('link', { name: 'Groups (120)' })).toBeInTheDocument()
    expect(screen.getByText('99+')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: 'Plans' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Me' })).toBeInTheDocument()
  })

  it('shows small counts as they are', () => {
    render(<BottomTabBar label="Main" items={items} activeId="home" />)
    expect(screen.getByRole('link', { name: 'Groups (3)' })).toHaveTextContent('3')
  })

  it('places the center action between the two halves', () => {
    render(
      <BottomTabBar
        label="Main"
        items={items}
        activeId="home"
        centerAction={<AddButton label="Add" />}
      />,
    )
    const entries = within(screen.getByRole('navigation')).getAllByRole('listitem')
    expect(entries).toHaveLength(5)
    expect(within(entries[2]!).getByRole('button', { name: 'Add' })).toBeInTheDocument()
  })

  it('renders through a custom link component', async () => {
    const onNavigate = vi.fn()
    const renderLink: RenderNavLink = ({ href, children, ...props }) => (
      <button type="button" onClick={() => onNavigate(href)} {...props}>
        {children}
      </button>
    )
    render(<BottomTabBar label="Main" items={items} activeId="groups" renderLink={renderLink} />)
    await userEvent.click(screen.getByRole('button', { name: 'Plans' }))
    expect(onNavigate).toHaveBeenCalledWith('/plans')
    expect(screen.getByRole('button', { name: 'Groups (3)' })).toHaveAttribute(
      'aria-current',
      'page',
    )
  })
})

describe('SideRail', () => {
  it('renders brand, action, links and footer', () => {
    render(
      <SideRail
        label="Main"
        items={items}
        activeId="plans"
        brand={<span>Potluck</span>}
        action={<button type="button">New</button>}
        footer={<span>Ada</span>}
      />,
    )
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getAllByRole('link')).toHaveLength(4)
    expect(within(nav).getByRole('link', { name: 'Plans' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByText('Potluck')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument()
    expect(screen.getByText('Ada')).toBeInTheDocument()
  })

  it('shows numeric badges and keeps them out of the visible name', () => {
    render(<SideRail label="Main" items={items} activeId="home" />)
    const groups = screen.getByRole('link', { name: 'Groups (3)' })
    expect(within(groups).getByText('3')).toHaveAttribute('aria-hidden', 'true')
    expect(screen.getByRole('link', { name: 'Me' })).toHaveTextContent(/^Me$/)
  })

  it('leaves out optional slots', () => {
    render(<SideRail label="Main" items={items} activeId="home" />)
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
    expect(screen.getByTestId('home-filled')).toBeInTheDocument()
  })
})

describe('AddButton', () => {
  it('is a named button that forwards its ref and clicks', async () => {
    const ref = createRef<HTMLButtonElement>()
    const onClick = vi.fn()
    render(<AddButton ref={ref} label="Add" size="md" onClick={onClick} />)
    const button = screen.getByRole('button', { name: 'Add' })
    expect(ref.current).toBe(button)
    expect(button).toHaveAttribute('type', 'button')
    expect(button).not.toHaveAttribute('aria-expanded')
    await userEvent.click(button)
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('reports its menu state when it opens a popup', () => {
    const { rerender } = render(<AddButton label="Add" aria-haspopup="menu" />)
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-expanded', 'false')
    rerender(<AddButton label="Add" aria-haspopup="menu" open />)
    expect(screen.getByRole('button', { name: 'Add' })).toHaveAttribute('aria-expanded', 'true')
  })
})
