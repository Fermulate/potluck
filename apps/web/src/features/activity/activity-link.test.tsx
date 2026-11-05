import { t } from '@potluck/i18n'
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { renderInRouter } from '@/features/expenses/router-test-utils'
import { RecentActivityRow } from './activity-link'

describe('RecentActivityRow', () => {
  it('opens the activity feed', async () => {
    renderInRouter(<RecentActivityRow />)
    const link = await screen.findByRole('link', { name: new RegExp(t('activity.recent')) })
    expect(link).toHaveAttribute('href', '/activity')
    expect(link).toHaveTextContent(t('activity.recentHint'))
  })
})
