import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createTelegramUiServer } from '../src/server.js'
import { InMemoryStore } from '../src/store.js'
import type { TelegramAdapter, InlineKeyboardMarkup } from '../src/types.js'

// -- Mock adapter ---------------------------------------------------------

function makeMockAdapter(): TelegramAdapter & {
  sentMessages: { chatId: string; text: string; keyboard?: InlineKeyboardMarkup }[]
  editedMessages: { chatId: string; messageId: number; text: string }[]
  answeredQueries: { id: string; text?: string }[]
  forceReplies: { chatId: string; text: string }[]
} {
  const sentMessages: { chatId: string; text: string; keyboard?: InlineKeyboardMarkup }[] = []
  const editedMessages: { chatId: string; messageId: number; text: string }[] = []
  const answeredQueries: { id: string; text?: string }[] = []
  const forceReplies: { chatId: string; text: string }[] = []
  let msgId = 1000

  return {
    sentMessages,
    editedMessages,
    answeredQueries,
    forceReplies,
    async sendMessage(chatId, text, keyboard) {
      sentMessages.push({ chatId, text, keyboard })
      return { messageId: msgId++ }
    },
    async editMessage(chatId, messageId, text) {
      editedMessages.push({ chatId, messageId, text })
    },
    async answerCallbackQuery(id, text) {
      answeredQueries.push({ id, text })
    },
    async sendForceReply(chatId, text) {
      forceReplies.push({ chatId, text })
      return { messageId: msgId++ }
    },
  }
}

// -- Tests ----------------------------------------------------------------

describe('createTelegramUiServer', () => {
  let adapter: ReturnType<typeof makeMockAdapter>
  let store: InMemoryStore

  beforeEach(() => {
    adapter = makeMockAdapter()
    store = new InMemoryStore()
  })

  it('returns server, handleCallbackQuery, handleForceReplyMessage, destroy', () => {
    const ui = createTelegramUiServer(adapter, '123', { store, timeoutMs: 100 })
    expect(ui.server).toBeDefined()
    expect(typeof ui.handleCallbackQuery).toBe('function')
    expect(typeof ui.handleForceReplyMessage).toBe('function')
    expect(typeof ui.destroy).toBe('function')
    ui.destroy()
  })
})

describe('handleCallbackQuery', () => {
  let adapter: ReturnType<typeof makeMockAdapter>
  let store: InMemoryStore

  beforeEach(() => {
    adapter = makeMockAdapter()
    store = new InMemoryStore()
  })

  it('ignores unknown question ID', async () => {
    const ui = createTelegramUiServer(adapter, '123', { store })
    await ui.handleCallbackQuery('q:unknown01:0', 'cbq1')
    expect(adapter.answeredQueries).toHaveLength(1)
    expect(adapter.editedMessages).toHaveLength(0)
    ui.destroy()
  })

  it('ignores non-question callback data', async () => {
    const ui = createTelegramUiServer(adapter, '123', { store })
    await ui.handleCallbackQuery('some:random:data', 'cbq1')
    expect(adapter.answeredQueries).toHaveLength(0)
    ui.destroy()
  })
})

describe('handleForceReplyMessage', () => {
  it('ignores unknown replyToMessageId', async () => {
    const store = new InMemoryStore()
    const adapter = makeMockAdapter()
    const ui = createTelegramUiServer(adapter, '123', { store })
    await ui.handleForceReplyMessage(9999, 'some text')
    expect(adapter.editedMessages).toHaveLength(0)
    ui.destroy()
  })
})

describe('destroy', () => {
  it('clears in-flight state without crashing', () => {
    const store = new InMemoryStore()
    const adapter = makeMockAdapter()
    const ui = createTelegramUiServer(adapter, '123', { store })
    expect(() => ui.destroy()).not.toThrow()
    expect(() => ui.destroy()).not.toThrow() // idempotent
  })
})
