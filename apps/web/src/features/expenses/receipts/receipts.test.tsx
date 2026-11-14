import { formatMoney, t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type * as Ocr from './ocr'
import { resetDb } from '@/test/supabase'
import { initialDraft } from '../form/split-state'
import { renderWithClient, seededClient } from '../test-utils'
import { AttachmentsField } from './attachments-field'
import type { AttachmentDraft } from './attachments-state'
import { ScanReceipt, type ScanResult } from './scan-receipt'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

const ocr = vi.hoisted(() => ({ text: '', fail: false }))
vi.mock('./ocr', async (original) => {
  const real = await original<typeof Ocr>()
  return {
    ...real,
    readReceiptText: vi.fn(
      async (_image: Blob, { onProgress }: { onProgress?: (p: unknown) => void } = {}) => {
        onProgress?.({ stage: 'loading', progress: 0.5 })
        onProgress?.({ stage: 'reading', progress: 0.4 })
        if (ocr.fail) throw new real.ReaderUnavailableError(new Error('fetch failed'))
        return [ocr.text]
      },
    ),
  }
})

const RECEIPT = `JOE'S DINER
11/08/2026 7:42 PM
2 Cheeseburger        25.00
Fries                  4.75
SUBTOTAL              29.75
Sales Tax              2.45
TOTAL                 32.20`

beforeEach(() => {
  resetDb()
  ocr.text = RECEIPT
  ocr.fail = false
  URL.createObjectURL = vi.fn(() => 'blob:photo')
  URL.revokeObjectURL = vi.fn()
})

const photo = () => new File(['jpg'], 'dinner.jpg', { type: 'image/jpeg' })

function renderScan({ canAttach = true, description = '' } = {}) {
  const onApply = vi.fn<(result: ScanResult) => void>()
  const view = renderWithClient(
    <>
      <ScanReceipt
        currency="USD"
        description={description}
        draft={initialDraft(['me', 'ben'])}
        memberIds={['me', 'ben']}
        timeZone="America/Chicago"
        canAttach={canAttach}
        onApply={onApply}
      />
      <Toaster label="Notifications" />
    </>,
    seededClient(),
  )
  const input = view.container.querySelector('input[type=file]') as HTMLInputElement
  const pick = async (file = photo()) => {
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } })
    })
  }
  return { onApply, pick }
}

describe('ScanReceipt', () => {
  it('reads a photo and offers each part to tick, filling the form only on request', async () => {
    const { onApply, pick } = renderScan()
    expect(screen.getByRole('button', { name: t('expenses.scan.button') })).toBeVisible()
    await pick()

    const sheet = await screen.findByRole('dialog', { name: t('expenses.scan.reviewTitle') })
    expect(within(sheet).getByText("Joe's Diner")).toBeInTheDocument()
    expect(within(sheet).getByText('2× Cheeseburger')).toBeInTheDocument()
    expect(within(sheet).getByText(t('expenses.scan.items', { count: 2 }))).toBeInTheDocument()
    expect(onApply).not.toHaveBeenCalled()

    // Leave the date out.
    fireEvent.click(
      within(sheet).getByRole('checkbox', { name: new RegExp(`^${t('expenses.scan.date')}`) }),
    )
    fireEvent.click(within(sheet).getByRole('button', { name: t('expenses.scan.apply') }))

    expect(onApply).toHaveBeenCalledTimes(1)
    const [{ fill, photo: attached }] = onApply.mock.calls[0]!
    expect(fill.description).toBe("Joe's Diner")
    expect(fill.spentAt).toBeUndefined()
    expect(fill.amount).toBe(3220)
    expect(fill.draft?.items.map((i) => i.name)).toEqual(['2× Cheeseburger', 'Fries'])
    expect(attached?.contentType).toBe('image/jpeg')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('can leave the photo off', async () => {
    const { onApply, pick } = renderScan()
    await pick()
    const sheet = await screen.findByRole('dialog', { name: t('expenses.scan.reviewTitle') })
    fireEvent.click(within(sheet).getByRole('checkbox', { name: t('expenses.scan.attach') }))
    fireEvent.click(within(sheet).getByRole('button', { name: t('expenses.scan.apply') }))
    expect(onApply.mock.calls[0]![0].photo).toBeNull()
  })

  it('says when the items and the total disagree', async () => {
    ocr.text = 'Cafe\nTea 3.00\nTOTAL 4.00'
    const { pick } = renderScan()
    await pick()
    expect(
      await screen.findByText(
        t('expenses.scan.itemsOff', {
          items: formatMoney(300, 'USD'),
          total: formatMoney(400, 'USD'),
        }),
      ),
    ).toBeInTheDocument()
  })

  it('says when no total line was read and the total was worked out', async () => {
    ocr.text = 'Cafe\nTea 3.00\nCake 4.00'
    const { pick } = renderScan()
    await pick()
    const sheet = await screen.findByRole('dialog', { name: t('expenses.scan.reviewTitle') })
    expect(within(sheet).getByText(t('expenses.scan.totalDerived'))).toBeInTheDocument()
  })

  it('says when the items are far off a subtotal taken for the total', async () => {
    ocr.text = 'Cafe\nTea 3.00\nSubtotal 7.00'
    const { pick } = renderScan()
    await pick()
    const sheet = await screen.findByRole('dialog', { name: t('expenses.scan.reviewTitle') })
    expect(within(sheet).getByText(t('expenses.scan.totalDerived'))).toBeInTheDocument()
    expect(
      within(sheet).getByText(
        t('expenses.scan.itemsOff', {
          items: formatMoney(300, 'USD'),
          total: formatMoney(700, 'USD'),
        }),
      ),
    ).toBeInTheDocument()
  })

  it('offers to attach the photo when nothing reads as prices', async () => {
    ocr.text = 'a blurry thumb'
    const { onApply, pick } = renderScan()
    await pick()
    expect(await screen.findByText(t('expenses.scan.nothing'))).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: t('expenses.scan.attachOnly') }))
    expect(onApply.mock.calls[0]![0]).toMatchObject({ fill: {} })
    expect(onApply.mock.calls[0]![0].photo).not.toBeNull()
  })

  it('explains a reader that would not start', async () => {
    ocr.fail = true
    const { pick } = renderScan()
    await pick()
    expect(await screen.findByText(t('expenses.scan.failed'))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: t('expenses.scan.again') })).toBeVisible()
  })

  it('asks for a connection when the first scan happens offline', async () => {
    ocr.fail = true
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
    const { pick } = renderScan()
    await pick()
    expect(await screen.findByText(t('expenses.scan.offline'))).toBeInTheDocument()
    vi.restoreAllMocks()
  })

  it('does not offer to attach when the expense is full', async () => {
    const { pick } = renderScan({ canAttach: false })
    await pick()
    const sheet = await screen.findByRole('dialog', { name: t('expenses.scan.reviewTitle') })
    expect(within(sheet).queryByRole('checkbox', { name: t('expenses.scan.attach') })).toBeNull()
  })
})

function Field({ initial = [] as AttachmentDraft[] }) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <AttachmentsField value={value} onChange={setValue} />
      <Toaster label="Notifications" />
    </>
  )
}

describe('AttachmentsField', () => {
  const add = async (files: File[]) => {
    const input = screen.getByLabelText(t('expenses.attachments.label'), {
      selector: 'input',
    })
    await act(async () => {
      fireEvent.change(input, { target: { files } })
    })
  }

  it('adds photos and PDFs, shows them and removes them', async () => {
    renderWithClient(<Field />, seededClient())
    expect(screen.getByRole('button', { name: t('expenses.attachments.addLabel') })).toBeVisible()
    await add([photo(), new File(['pdf'], 'bill.pdf', { type: 'application/pdf' })])

    const one = t('expenses.attachments.photo', { number: 1 })
    expect(await screen.findByRole('img', { name: one })).toHaveAttribute('src', 'blob:photo')
    expect(
      screen.getByRole('img', { name: t('expenses.attachments.pdf', { number: 2 }) }),
    ).toBeInTheDocument()
    expect(screen.getByText(t('expenses.attachments.count', { count: 2, max: 5 }))).toBeVisible()

    fireEvent.click(
      screen.getByRole('button', { name: t('expenses.attachments.remove', { name: one }) }),
    )
    expect(screen.queryByRole('img', { name: one })).toBeNull()
    expect(screen.getByText(t('expenses.attachments.count', { count: 1, max: 5 }))).toBeVisible()
  })

  it('refuses other files and stops at five', async () => {
    renderWithClient(<Field />, seededClient())
    await add([new File(['x'], 'notes.txt', { type: 'text/plain' })])
    expect(await screen.findByText(t('expenses.receiptUpload.wrongType'))).toBeInTheDocument()

    await add(
      Array.from({ length: 6 }, (_, i) => new File(['x'], `p${i}.jpg`, { type: 'image/jpeg' })),
    )
    expect(await screen.findByText(t('expenses.attachments.leftOut'))).toBeInTheDocument()
    expect(screen.getByText(t('expenses.attachments.full'))).toBeVisible()
    expect(screen.queryByRole('button', { name: t('expenses.attachments.addLabel') })).toBeNull()
  })

  it('refuses a file over 10 MB', async () => {
    renderWithClient(<Field />, seededClient())
    const big = new File(['x'], 'huge.pdf', { type: 'application/pdf' })
    Object.defineProperty(big, 'size', { value: 11 * 1024 * 1024 })
    await add([big])
    expect(await screen.findByText(t('expenses.receiptUpload.tooBig'))).toBeInTheDocument()
  })
})
