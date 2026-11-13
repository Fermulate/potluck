import type * as Api from '@potluck/api'
import { moneyKeys, setDefaultSplit } from '@potluck/api'
import { t } from '@potluck/i18n'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  BEN,
  CLEO,
  GROUP_ID,
  ME,
  group,
  renderWithClient,
  seededClient,
} from '@/features/expenses/test-utils'
import { DefaultSplitSection } from './default-split-section'

vi.mock('@/lib/supabase', () => import('@/features/expenses/fake-supabase'))
vi.mock('@/lib/auth', () => ({ useUserId: () => 'aaaaaaaa-0000-4000-8000-000000000001' }))
vi.mock('@potluck/api', async (importOriginal) => ({
  ...(await importOriginal<typeof Api>()),
  setDefaultSplit: vi.fn(async (_client: unknown, _group: string, split: unknown) => split),
}))

const save = vi.mocked(setDefaultSplit)

function renderSection(defaultSplit: Api.DefaultSplit | null) {
  return renderWithClient(
    <DefaultSplitSection groupId={GROUP_ID} />,
    seededClient((c) =>
      c.setQueryData(moneyKeys.groupInfo(GROUP_ID), { ...group, default_split: defaultSplit }),
    ),
  )
}

describe('DefaultSplitSection', () => {
  beforeEach(() => save.mockClear())

  it('says how new expenses split, you first', () => {
    renderSection({
      split_type: 'percent',
      splits: [
        { user_id: BEN, weight: 40 },
        { user_id: ME, weight: 60 },
      ],
    })
    expect(
      screen.getByText(
        t('groups.settings.defaultSplit.percent', { people: 'you 60% and Ben 40%' }),
      ),
    ).toBeVisible()
  })

  it('saves a new default from the split editor, and clears it', async () => {
    renderSection(null)
    expect(screen.getByText(t('groups.settings.defaultSplit.equalAll'))).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('groups.settings.defaultSplit.change') }))
    const sheet = await screen.findByRole('dialog', {
      name: t('groups.settings.defaultSplit.title'),
    })
    // Only the splits that work without an amount.
    expect(within(sheet).queryByRole('radio', { name: 'Exact' })).not.toBeInTheDocument()
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Shares' }))
    fireEvent.click(within(sheet).getByRole('button', { name: 'More shares for You' }))
    fireEvent.click(
      within(sheet).getByRole('button', { name: t('groups.settings.defaultSplit.save') }),
    )
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
    expect(save.mock.calls[0]![2]).toEqual({
      split_type: 'shares',
      splits: [
        { user_id: ME, weight: 2 },
        { user_id: BEN, weight: 1 },
        { user_id: CLEO, weight: 1 },
      ],
    })
  })

  it('never stores equal between everyone as a member list', async () => {
    renderSection({
      split_type: 'shares',
      splits: [
        { user_id: ME, weight: 2 },
        { user_id: BEN, weight: 1 },
        { user_id: CLEO, weight: 1 },
      ],
    })
    fireEvent.click(screen.getByRole('button', { name: t('groups.settings.defaultSplit.change') }))
    const sheet = await screen.findByRole('dialog')
    const saveButton = within(sheet).getByRole('button', {
      name: t('groups.settings.defaultSplit.save'),
    })
    expect(saveButton).toBeDisabled()
    fireEvent.click(within(sheet).getByRole('radio', { name: 'Equal' }))
    fireEvent.click(saveButton)
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.anything(), GROUP_ID, null))
  })

  it('has nothing to save when new expenses already split equally between everyone', async () => {
    renderSection(null)
    fireEvent.click(screen.getByRole('button', { name: t('groups.settings.defaultSplit.change') }))
    const sheet = await screen.findByRole('dialog')
    expect(
      within(sheet).getByRole('button', { name: t('groups.settings.defaultSplit.save') }),
    ).toBeDisabled()
  })

  it('goes back to equal', async () => {
    renderSection({ split_type: 'equal', splits: [{ user_id: ME, weight: null }] })
    expect(
      screen.getByText(t('groups.settings.defaultSplit.equalSome', { people: 'you' })),
    ).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: t('groups.settings.defaultSplit.change') }))
    const sheet = await screen.findByRole('dialog')
    fireEvent.click(
      within(sheet).getByRole('button', { name: t('groups.settings.defaultSplit.clear') }),
    )
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.anything(), GROUP_ID, null))
  })
})
