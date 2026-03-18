import { describe, it, expect, beforeEach } from 'vitest'
import { InMemoryStore } from '../src/store.js'
import type { PendingQuestion } from '../src/types.js'

function makeQuestion(overrides: Partial<PendingQuestion> = {}): PendingQuestion {
  return {
    id: 'test01',
    chatId: '123',
    messageId: null,
    question: 'Pick one',
    header: null,
    options: [{ label: 'A', description: 'Option A' }, { label: 'B', description: 'Option B' }],
    multiSelect: false,
    selected: [],
    answered: false,
    createdAt: Math.floor(Date.now() / 1000),
    expiresAt: Math.floor(Date.now() / 1000) + 300,
    ...overrides,
  }
}

describe('InMemoryStore', () => {
  let store: InMemoryStore

  beforeEach(() => {
    store = new InMemoryStore()
  })

  it('returns undefined for unknown id', async () => {
    expect(await store.get('nope')).toBeUndefined()
  })

  it('stores and retrieves a question', async () => {
    const q = makeQuestion()
    await store.set(q.id, q)
    expect(await store.get(q.id)).toEqual(q)
  })

  it('deletes a question', async () => {
    const q = makeQuestion()
    await store.set(q.id, q)
    await store.delete(q.id)
    expect(await store.get(q.id)).toBeUndefined()
  })

  it('returns empty array when no questions are expired', async () => {
    const q = makeQuestion({ expiresAt: Math.floor(Date.now() / 1000) + 9999 })
    await store.set(q.id, q)
    expect(await store.getExpired(Math.floor(Date.now() / 1000))).toEqual([])
  })

  it('returns expired unanswered questions', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const q = makeQuestion({ expiresAt: past })
    await store.set(q.id, q)
    const expired = await store.getExpired(Math.floor(Date.now() / 1000))
    expect(expired).toHaveLength(1)
    expect(expired[0].id).toBe(q.id)
  })

  it('does not return expired questions that are already answered', async () => {
    const past = Math.floor(Date.now() / 1000) - 10
    const q = makeQuestion({ expiresAt: past, answered: true })
    await store.set(q.id, q)
    expect(await store.getExpired(Math.floor(Date.now() / 1000))).toEqual([])
  })

  it('does not return a question whose expiresAt equals now (boundary: strict less-than)', async () => {
    const now = Math.floor(Date.now() / 1000)
    const q = makeQuestion({ expiresAt: now })
    await store.set(q.id, q)
    expect(await store.getExpired(now)).toEqual([])
  })

  it('allows updating a question via set', async () => {
    const q = makeQuestion()
    await store.set(q.id, q)
    const updated = { ...q, messageId: 42 }
    await store.set(q.id, updated)
    expect((await store.get(q.id))?.messageId).toBe(42)
  })
})
