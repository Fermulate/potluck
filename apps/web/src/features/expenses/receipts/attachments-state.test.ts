import type { ExpenseAttachment } from '@potluck/api'
import { describe, expect, it, vi } from 'vitest'
import {
  addDrafts,
  attachmentsChanged,
  draftFromFile,
  draftsFromStored,
  isPdf,
  saveAttachments,
  uploadDrafts,
  type AttachmentDraft,
} from './attachments-state'
import { fitWithin, prepareImage } from './image'

const api = vi.hoisted(() => ({
  uploadReceipt: vi.fn(
    async (_c: unknown, groupId: string, _f: unknown, o: { extension: string }) =>
      `${groupId}/new.${o.extension}`,
  ),
  setExpenseAttachments: vi.fn(async () => []),
  removeReceiptFiles: vi.fn(async () => undefined),
}))
vi.mock('@potluck/api', async (original) => ({ ...(await original()), ...api }))

const stored = (position: number, path: string, type = 'image/jpeg'): ExpenseAttachment => ({
  expense_id: 'e1',
  position,
  path,
  content_type: type,
  uploaded_by: 'u1',
  created_at: '2026-11-13T10:00:00Z',
})
const file = (name: string, type: string) => new File(['x'], name, { type })
const client = {} as never

describe('attachment drafts', () => {
  it('reads stored files in order', () => {
    const drafts = draftsFromStored([stored(1, 'g/b.pdf', 'application/pdf'), stored(0, 'g/a.jpg')])
    expect(drafts.map((d) => [d.path, isPdf(d)])).toEqual([
      ['g/a.jpg', false],
      ['g/b.pdf', true],
    ])
  })

  it('takes photos and PDFs, nothing else', () => {
    expect(draftFromFile(file('r.png', 'image/png'))?.contentType).toBe('image/png')
    expect(draftFromFile(file('r.HEIC', ''))?.contentType).toBe('image/heic')
    expect(draftFromFile(file('r.txt', 'text/plain'))).toBeNull()
  })

  it('adds up to five and counts the rest', () => {
    const four = draftsFromStored([0, 1, 2, 3].map((i) => stored(i, `g/${i}.jpg`)))
    const added = [
      draftFromFile(file('a.jpg', 'image/jpeg'))!,
      draftFromFile(file('b.jpg', 'image/jpeg'))!,
    ]
    const { drafts, leftOut } = addDrafts(four, added)
    expect(drafts).toHaveLength(5)
    expect(leftOut).toBe(1)
  })

  it('notices new files, removals and a new order', () => {
    const list = [stored(0, 'g/a.jpg'), stored(1, 'g/b.jpg')]
    const same = draftsFromStored(list)
    expect(attachmentsChanged(same, list)).toBe(false)
    expect(attachmentsChanged([same[1]!, same[0]!], list)).toBe(true)
    expect(attachmentsChanged(same.slice(1), list)).toBe(true)
    expect(attachmentsChanged([...same, draftFromFile(file('c.jpg', 'image/jpeg'))!], list)).toBe(
      true,
    )
  })

  it('uploads only new files and keeps the order', async () => {
    const drafts: AttachmentDraft[] = [
      { key: 'a', path: 'g/a.jpg', contentType: 'image/jpeg' },
      draftFromFile(file('scan.png', 'image/png'))!,
    ]
    expect(await uploadDrafts(client, 'g', drafts)).toEqual(['g/a.jpg', 'g/new.png'])
    expect(api.uploadReceipt).toHaveBeenCalledTimes(1)
  })

  it('saves the list, then deletes what left it', async () => {
    await saveAttachments(client, 'e1', ['g/b.jpg'], [stored(0, 'g/a.jpg'), stored(1, 'g/b.jpg')])
    expect(api.setExpenseAttachments).toHaveBeenCalledWith(client, 'e1', ['g/b.jpg'])
    expect(api.removeReceiptFiles).toHaveBeenCalledWith(client, ['g/a.jpg'])
  })
})

describe('photos', () => {
  it('fit inside 2000 pixels without growing', () => {
    expect(fitWithin(4032, 3024)).toEqual({ width: 2000, height: 1500 })
    expect(fitWithin(1000, 3000)).toEqual({ width: 667, height: 2000 })
    expect(fitWithin(800, 600)).toEqual({ width: 800, height: 600 })
    expect(fitWithin(0, 0)).toEqual({ width: 1, height: 1 })
  })

  it('come back untouched when they cannot be decoded here', async () => {
    const pdf = file('r.pdf', 'application/pdf')
    expect(await prepareImage(pdf)).toBe(pdf)
    // jsdom has no createImageBitmap: the photo goes up as it was.
    const photo = file('r.jpg', 'image/jpeg')
    expect(await prepareImage(photo)).toBe(photo)
  })
})
