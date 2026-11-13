import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderWithProviders } from '@/test/render'
import { SearchIconLink } from './search-link'
import { useSearchShortcut } from './use-search-shortcut'

function Page() {
  useSearchShortcut()
  return (
    <>
      <SearchIconLink />
      <input aria-label="Note" />
    </>
  )
}

describe('search entry points', () => {
  it('links to search', async () => {
    renderWithProviders(<Page />, { path: '/home' })
    expect(await screen.findByRole('link', { name: t('search.open') })).toHaveAttribute(
      'href',
      '/search',
    )
  })

  it('opens search on "/" unless the viewer is typing', async () => {
    const { router } = renderWithProviders(<Page />, { path: '/home' })
    const note = await screen.findByRole('textbox', { name: 'Note' })
    fireEvent.keyDown(note, { key: '/' })
    expect(router.state.location.pathname).toBe('/home')
    fireEvent.keyDown(window, { key: '/', ctrlKey: true })
    expect(router.state.location.pathname).toBe('/home')
    fireEvent.keyDown(document.body, { key: '/' })
    await waitFor(() => expect(router.state.location.pathname).toBe('/search'))
  })
})
