import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { HomePage } from './home-page'

it('renders the app name', () => {
  render(<HomePage />)
  expect(screen.getByRole('heading', { name: 'Potluck' })).toBeInTheDocument()
})
