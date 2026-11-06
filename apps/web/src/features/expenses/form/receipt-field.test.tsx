import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, screen } from '@testing-library/react'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, resetDb } from '@/test/supabase'
import { renderWithClient, seededClient } from '../test-utils'
import { receiptExtension, receiptType } from './receipt'
import { ReceiptField, type ReceiptValue } from './receipt-field'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function Harness({
  initial,
  onChange,
}: {
  initial: ReceiptValue
  onChange: (v: ReceiptValue) => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <>
      <ReceiptField
        value={value}
        onChange={(next) => {
          setValue(next)
          onChange(next)
        }}
      />
      <Toaster label="Notifications" />
    </>
  )
}

function renderField(initial: ReceiptValue = { file: null, existingPath: null }) {
  const onChange = vi.fn()
  renderWithClient(<Harness initial={initial} onChange={onChange} />, seededClient())
  return { onChange, input: screen.getByLabelText(t('expenses.fields.receipt')) }
}

describe('ReceiptField', () => {
  beforeEach(() => {
    resetDb()
    URL.createObjectURL = vi.fn(() => 'blob:receipt')
    URL.revokeObjectURL = vi.fn()
  })

  it('takes a photo and shows it, ready to replace or remove', () => {
    const { input, onChange } = renderField()
    expect(screen.getByRole('button', { name: t('expenses.fields.addReceipt') })).toBeVisible()
    const photo = new File(['jpg'], 'dinner.jpg', { type: 'image/jpeg' })
    fireEvent.change(input, { target: { files: [photo] } })

    expect(onChange).toHaveBeenLastCalledWith({ file: photo, existingPath: null })
    expect(screen.getByText('dinner.jpg')).toBeInTheDocument()
    expect(document.querySelector('img')).toHaveAttribute('src', 'blob:receipt')

    fireEvent.click(screen.getByRole('button', { name: t('expenses.fields.removeReceipt') }))
    expect(onChange).toHaveBeenLastCalledWith({ file: null, existingPath: null })
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:receipt')
  })

  it('rejects other file types and anything over 10 MB', async () => {
    const { input, onChange } = renderField()
    fireEvent.change(input, {
      target: { files: [new File(['x'], 'notes.txt', { type: 'text/plain' })] },
    })
    expect(await screen.findByText(t('expenses.receiptUpload.wrongType'))).toBeInTheDocument()

    const big = new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'scan.pdf', {
      type: 'application/pdf',
    })
    fireEvent.change(input, { target: { files: [big] } })
    expect(await screen.findByText(t('expenses.receiptUpload.tooBig'))).toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('takes an iPhone HEIC photo the browser could not type', () => {
    const { input, onChange } = renderField()
    const photo = new File(['heic'], 'IMG_0042.HEIC', { type: '' })
    fireEvent.change(input, { target: { files: [photo] } })
    expect(onChange).toHaveBeenLastCalledWith({ file: photo, existingPath: null })
  })

  it('shows the stored receipt when editing', async () => {
    db().respond('storage:receipts.createSignedUrl', {
      data: { signedUrl: 'https://files.test/r.png' },
    })
    renderField({ file: null, existingPath: 'g/r.png' })
    expect(screen.getByRole('button', { name: t('expenses.receiptUpload.change') })).toBeVisible()
    await vi.waitFor(() =>
      expect(document.querySelector('img')).toHaveAttribute('src', 'https://files.test/r.png'),
    )
  })

  it('shows a document icon for a stored PDF', () => {
    renderField({ file: null, existingPath: 'g/r.PDF' })
    expect(document.querySelector('img')).toBeNull()
  })
})

describe('receiptExtension', () => {
  it('prefers the type, then the file name', () => {
    expect(receiptExtension(new File([], 'a', { type: 'image/jpeg' }))).toBe('jpg')
    expect(receiptExtension(new File([], 'scan.tiff', { type: 'image/tiff' }))).toBe('tiff')
  })
})

describe('receiptType', () => {
  it('keeps a type the bucket accepts', () => {
    expect(receiptType(new File([], 'a.png', { type: 'image/png' }))).toBe('image/png')
  })

  it('reads the extension when the browser gave no type', () => {
    expect(receiptType(new File([], 'IMG_1.heic', { type: '' }))).toBe('image/heic')
    expect(receiptType(new File([], 'IMG_1.HEIF', { type: '' }))).toBe('image/heic')
    expect(receiptType(new File([], 'scan.pdf', { type: 'application/octet-stream' }))).toBe(
      'application/pdf',
    )
  })

  it('refuses everything else', () => {
    expect(receiptType(new File([], 'notes.txt', { type: 'text/plain' }))).toBeNull()
    expect(receiptType(new File([], 'notes.heic', { type: 'text/plain' }))).toBeNull()
    expect(receiptType(new File([], 'mystery', { type: '' }))).toBeNull()
  })
})
