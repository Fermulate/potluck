import { t } from '@potluck/i18n'
import { Toaster } from '@potluck/ui'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { db, resetDb } from '@/test/supabase'
import { AvatarPicker } from './avatar-picker'

vi.mock('@/lib/supabase', () => import('@/test/supabase'))

function setup(onUploaded = vi.fn()) {
  render(
    <>
      <AvatarPicker userId="u-ava" name="Ava Chen" src={null} onUploaded={onUploaded} />
      <Toaster label="Notifications" />
    </>,
  )
  return { onUploaded, input: screen.getByLabelText(t('onboarding.profile.avatarLabel')) }
}

function pick(input: HTMLElement, file: File) {
  fireEvent.change(input, { target: { files: [file] } })
}

function uploads() {
  return db()
    .storageCalls('avatars')
    .filter((call) => call.method === 'upload')
}

describe('AvatarPicker', () => {
  beforeEach(() => {
    resetDb()
    URL.createObjectURL = vi.fn(() => 'blob:preview')
  })

  it('uploads a photo under the user folder and hands back the path', async () => {
    const { input, onUploaded } = setup()
    pick(input, new File(['png-bytes'], 'me.png', { type: 'image/png' }))

    await waitFor(() => expect(onUploaded).toHaveBeenCalledTimes(1))
    const [call] = uploads()
    const path = call!.args[0] as string
    expect(path).toMatch(/^u-ava\/[a-z0-9]+\.png$/)
    expect(call!.args[2]).toMatchObject({ contentType: 'image/png', upsert: false })
    expect(onUploaded).toHaveBeenCalledWith(path)
    await waitFor(() => expect(input).toBeEnabled())
    expect(input).toHaveValue('')
  })

  it('rejects files that are not images', async () => {
    const { input, onUploaded } = setup()
    pick(input, new File(['%PDF'], 'cv.pdf', { type: 'application/pdf' }))
    expect(await screen.findByText(t('onboarding.profile.photoType'))).toBeInTheDocument()
    expect(uploads()).toEqual([])
    expect(onUploaded).not.toHaveBeenCalled()
  })

  it('rejects photos over 5 MB', async () => {
    const { input } = setup()
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'big.jpg', { type: 'image/jpeg' })
    pick(input, big)
    expect(await screen.findByText(t('onboarding.profile.photoTooBig'))).toBeInTheDocument()
    expect(uploads()).toEqual([])
  })

  it('explains when the upload fails and lets you pick again', async () => {
    db().respond('storage:avatars.upload', { error: { message: 'Payload too large' } })
    const { input, onUploaded } = setup()
    pick(input, new File(['gif'], 'me.gif', { type: 'image/gif' }))
    expect(await screen.findByText(t('onboarding.profile.photoFailed'))).toBeInTheDocument()
    expect(onUploaded).not.toHaveBeenCalled()
    expect(input).toBeEnabled()
  })
})
