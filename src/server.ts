import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import { InMemoryStore } from './store.js'
import { generateShortId, buildInlineKeyboard, formatQuestionText, parseCallbackData } from './keyboard.js'
import type {
  TelegramAdapter,
  TelegramUiOptions,
  PendingQuestion,
  QuestionOption,
} from './types.js'

// McpServer type derived from SDK to avoid coupling types.ts to SDK
type McpServer = ReturnType<typeof createSdkMcpServer>

// TelegramUiServer defined here (not in types.ts) -- avoids SDK import in types.ts
export interface TelegramUiServer {
  server: McpServer
  handleCallbackQuery(callbackData: string, callbackQueryId: string): Promise<void>
  handleForceReplyMessage(replyToMessageId: number, answerText: string): Promise<boolean>
  destroy(): void
}

// -- Module-level singletons (one instance per process) -------------------

export const pendingResolvers = new Map<string, (answer: string) => void>()
export const pendingForceReplies = new Map<number, string>() // messageId -> questionId

// -- Factory --------------------------------------------------------------

export function createTelegramUiServer(
  adapter: TelegramAdapter,
  chatId: string,
  options: TelegramUiOptions = {}
): TelegramUiServer {
  const timeoutMs = options.timeoutMs ?? 300_000
  const store = options.store ?? new InMemoryStore()

  // -- ask_user tool handler -------------------------------------------

  async function handleAskUser(args: {
    question: string
    options: QuestionOption[]
    header?: string
    multi_select?: boolean
  }): Promise<string> {
    if (args.options.length < 2 || args.options.length > 4) {
      return 'ask_user requires between 2 and 4 options.'
    }

    const questionId = generateShortId()
    const multiSelect = args.multi_select ?? false
    const now = Math.floor(Date.now() / 1000)

    const question: PendingQuestion = {
      id: questionId,
      chatId,
      messageId: null,
      question: args.question,
      header: args.header ?? null,
      options: args.options,
      multiSelect,
      selected: [],
      answered: false,
      createdAt: now,
      expiresAt: now + Math.floor(timeoutMs / 1000),
    }

    await store.set(questionId, question)

    const kb = buildInlineKeyboard(questionId, args.options, multiSelect)
    const text = formatQuestionText(args.question, args.header, args.options)

    let sentMessageId: number
    try {
      const sent = await adapter.sendMessage(chatId, text, kb)
      sentMessageId = sent.messageId
      const updated = { ...question, messageId: sentMessageId }
      await store.set(questionId, updated)
    } catch {
      await store.delete(questionId)
      return 'Failed to reach user. Proceed with best judgment.'
    }

    // Wait for answer
    const answer = await new Promise<string>((resolve) => {
      pendingResolvers.set(questionId, resolve)

      setTimeout(async () => {
        if (pendingResolvers.has(questionId)) {
          pendingResolvers.delete(questionId)
          const q = await store.get(questionId)
          if (q?.messageId) {
            adapter.editMessage(chatId, q.messageId, `${text}\n\n-- Question expiree`, { inline_keyboard: [] } as never).catch(() => {})
          }
          await store.delete(questionId)
          resolve('__timeout__')
        }
      }, timeoutMs)
    })

    pendingResolvers.delete(questionId)

    if (answer === '__timeout__') {
      const minutes = Math.round(timeoutMs / 60_000)
      return `User did not respond within ${minutes} minutes. Proceed with best judgment.`
    }

    return answer
  }

  // -- MCP server -------------------------------------------------------

  const server = createSdkMcpServer({
    name: 'telegram-ui',
    version: '1.0.0',
    tools: [
      tool(
        'ask_user',
        'Ask the Telegram user a question with clickable buttons. Returns their chosen option or custom text answer.',
        {
          question: z.string().describe('The question to ask'),
          options: z
            .array(z.object({ label: z.string(), description: z.string() }))
            .min(2)
            .max(4)
            .describe('2-4 options to choose from'),
          header: z.string().optional().describe('Short label (max 12 chars)'),
          multi_select: z.boolean().optional().default(false),
        },
        async (args) => {
          const answer = await handleAskUser(args as {
            question: string
            options: QuestionOption[]
            header?: string
            multi_select?: boolean
          })
          return { content: [{ type: 'text' as const, text: answer }] }
        }
      ),
    ],
  })

  // -- handleCallbackQuery ----------------------------------------------

  async function handleCallbackQuery(callbackData: string, callbackQueryId: string): Promise<void> {
    const action = parseCallbackData(callbackData)
    if (!action) return

    const q = await store.get(action.questionId)
    if (!q) {
      await adapter.answerCallbackQuery(callbackQueryId).catch(() => {})
      return
    }

    if (q.answered) {
      await adapter.answerCallbackQuery(callbackQueryId).catch(() => {})
      return
    }

    const text = formatQuestionText(q.question, q.header ?? undefined, q.options)

    if (action.action === 'select') {
      const chosen = q.options[action.index]
      if (!chosen) {
        await adapter.answerCallbackQuery(callbackQueryId).catch(() => {})
        return
      }

      const updated = { ...q, answered: true }
      await store.set(q.id, updated)

      if (q.messageId) {
        await adapter.editMessage(q.chatId, q.messageId, `${text}\n\n-> ${chosen.label}`).catch(() => {})
      }

      const resolver = pendingResolvers.get(q.id)
      if (resolver) {
        resolver(chosen.label)
        pendingResolvers.delete(q.id)
      }

    } else if (action.action === 'toggle') {
      let selected = [...q.selected]
      if (selected.includes(action.index)) {
        selected = selected.filter(i => i !== action.index)
      } else {
        selected.push(action.index)
      }

      const updated = { ...q, selected }
      await store.set(q.id, updated)

      const kb = buildInlineKeyboard(q.id, q.options, true, selected)
      if (q.messageId) {
        await adapter.editMessage(q.chatId, q.messageId, text, kb).catch(() => {})
      }

    } else if (action.action === 'done') {
      if (q.selected.length === 0) {
        await adapter.answerCallbackQuery(callbackQueryId, 'Select at least one option').catch(() => {})
        return
      }

      const chosenLabels = q.selected.map(i => q.options[i]?.label).filter(Boolean)
      const answer = chosenLabels.join(', ')

      const updated = { ...q, answered: true }
      await store.set(q.id, updated)

      if (q.messageId) {
        await adapter.editMessage(q.chatId, q.messageId, `${text}\n\n-> ${answer}`).catch(() => {})
      }

      const resolver = pendingResolvers.get(q.id)
      if (resolver) {
        resolver(answer)
        pendingResolvers.delete(q.id)
      }

    } else if (action.action === 'other') {
      try {
        const sent = await adapter.sendForceReply(q.chatId, 'Ecris ta reponse :')
        pendingForceReplies.set(sent.messageId, q.id)
      } catch {
        // ignore
      }
    }

    await adapter.answerCallbackQuery(callbackQueryId).catch(() => {})
  }

  // -- handleForceReplyMessage ------------------------------------------

  async function handleForceReplyMessage(replyToMessageId: number, answerText: string): Promise<boolean> {
    const questionId = pendingForceReplies.get(replyToMessageId)
    if (!questionId) return false

    pendingForceReplies.delete(replyToMessageId)

    const q = await store.get(questionId)
    if (!q || q.answered) return false

    const updated = { ...q, answered: true }
    await store.set(q.id, updated)

    if (q.messageId) {
      const text = formatQuestionText(q.question, q.header ?? undefined, q.options)
      await adapter.editMessage(q.chatId, q.messageId, `${text}\n\n-> ${answerText}`).catch(() => {})
    }

    const resolver = pendingResolvers.get(q.id)
    if (resolver) {
      resolver(answerText)
      pendingResolvers.delete(q.id)
    }
    return true
  }

  // -- Cleanup interval (safety net) ------------------------------------

  const cleanupInterval = setInterval(async () => {
    const now = Math.floor(Date.now() / 1000)
    const expired = await store.getExpired(now)

    for (const q of expired) {
      const text = formatQuestionText(q.question, q.header ?? undefined, q.options)
      if (q.messageId) {
        await adapter.editMessage(q.chatId, q.messageId, `${text}\n\n-- Question expiree`).catch(() => {})
      }

      const resolver = pendingResolvers.get(q.id)
      if (resolver) {
        resolver('__timeout__')
        pendingResolvers.delete(q.id)
      }

      await store.delete(q.id)
    }
  }, 60_000)

  // -- destroy ----------------------------------------------------------

  function destroy(): void {
    clearInterval(cleanupInterval)
    pendingResolvers.clear()
    pendingForceReplies.clear()
  }

  return { server, handleCallbackQuery, handleForceReplyMessage, destroy }
}
