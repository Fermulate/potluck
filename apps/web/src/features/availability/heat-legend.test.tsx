import { t } from '@potluck/i18n'
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { HeatLegend } from './availability-heatmap'

describe('HeatLegend', () => {
  it('leaves out the busy swatch when there is no busy time on the grid', () => {
    render(<HeatLegend />)
    expect(screen.getByText(t('availability.heatLegendNobody'))).toBeInTheDocument()
    expect(screen.queryByText(t('availability.busy'))).not.toBeInTheDocument()
  })

  it('explains the hatching once busy time shows up', () => {
    render(<HeatLegend showBusy />)
    expect(screen.getByText(t('availability.busy'))).toBeInTheDocument()
  })

  it('links to the heatmap section of the guide', () => {
    render(<HeatLegend />)
    expect(
      screen.getByRole('link', { name: new RegExp(t('help.topics.heatmap')) }),
    ).toHaveAttribute('href', expect.stringContaining('/plans/availability/#the-live-heatmap'))
  })
})
