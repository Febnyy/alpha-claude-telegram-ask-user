import { InlineKeyboard, type Bot, type Context } from 'grammy'
import { randomBytes } from 'crypto'
import { createSdkMcpServer, tool } from '@anthropic-ai/claude-agent-sdk'
import { z } from 'zod'
import {
  createPendingQuestion,
  getPendingQuestion,
  answerPendingQuestion,
  getExpiredQuestions,
  deletePendingQuestion,
  updatePendingQuestionMessageId,
  updatePendingQuestionSelected,
} from './db.js'

// -- Module-level resolver registry ----------------------------------------
// Shared between createTelegramUiServer (writes) and callback_query handler (resolves)

export const pendingResolvers = new Map<string, {
  resolve: (answer: string) => void
  reject: (reason: string) => void
}>()

// -- Pending ForceReply tracking -------------------------------------------
// Maps message_id of the ForceReply prompt -> question_id
export const pendingForceReplies = new Map<number, string>()

// -- Short ID generator ----------------------------------------------------

export function generateShortId(): string {
  return randomBytes(4).toString('hex') // 8 hex chars
}

// -- Callback data parser --------------------------------------------------

export type CallbackAction =
  | { questionId: string; action: 'select'; index: number }
  | { questionId: string; action: 'toggle'; index: number }
  | { questionId: string; action: 'done' }
  | { questionId: string; action: 'other' }

export function parseCallbackData(data: string): CallbackAction | null {
  if (!data.startsWith('q:')) return null

  const parts = data.split(':')
  if (parts.length < 3) return null
  const questionId = parts[1]

  if (parts[2] === 'done') return { questionId, action: 'done' }
  if (parts[2] === 'other') return { questionId, action: 'other' }
  if (parts[2] === 't' && parts.length === 4) {
    return { questionId, action: 'toggle', index: parseInt(parts[3], 10) }
  }
  const index = parseInt(parts[2], 10)
  if (isNaN(index)) return null
  return { questionId, action: 'select', index }
}

// -- InlineKeyboard builder ------------------------------------------------

export interface QuestionOption {
  label: string
  description: string
}

export function buildInlineKeyboard(
  questionId: string,
  options: QuestionOption[],
  multiSelect: boolean
): InlineKeyboard {
  const kb = new InlineKeyboard()

  for (let i = 0; i < options.length; i++) {
    const callbackData = multiSelect
      ? `q:${questionId}:t:${i}`
      : `q:${questionId}:${i}`
    kb.text(options[i].label, callbackData)
    if (i % 2 === 1 || i === options.length - 1) kb.row()
  }

  kb.text('Autre', `q:${questionId}:other`)
  if (multiSelect) {
    kb.text('Valider', `q:${questionId}:done`)
  }
  kb.row()

  return kb
}

// -- Format question text --------------------------------------------------

export function formatQuestionText(
  question: string,
  header: string | undefined,
  options: QuestionOption[]
): string {
  const headerLine = header ? `[${header}] ` : ''
  const optionLines = options
    .map((o, i) => `${i + 1}. ${o.label} -- ${o.description}`)
    .join('\n')
  return `${headerLine}${question}\n\n${optionLines}`
}

// -- MCP Server Factory ----------------------------------------------------

const QUESTION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes

export function createTelegramUiServer(
  bot: Bot<Context>,
  chatId: string
): { server: ReturnType<typeof createSdkMcpServer> } {
  const server = createSdkMcpServer({
    name: 'telegram-ui',
    version: '1.0.0',
    tools: [
      tool(
        'ask_user',
        'Ask the Telegram user a question with clickable buttons. Returns their chosen option or custom text answer.',
        {
          question: z.string().describe('The question to ask'),
          options: z.array(z.object({
            label: z.string(),
            description: z.string(),
          })).min(2).max(4).describe('2-4 options to choose from'),
          header: z.string().optional().describe('Short label (max 12 chars)'),
          multi_select: z.boolean().optional().default(false),
        },
        async (args) => {
          const questionId = generateShortId()
          const options: QuestionOption[] = args.options
          const multiSelect = args.multi_select ?? false
          const now = Math.floor(Date.now() / 1000)

          createPendingQuestion({
            id: questionId,
            chat_id: chatId,
            question: args.question,
            header: args.header ?? null,
            options: JSON.stringify(options),
            multi_select: multiSelect ? 1 : 0,
            created_at: now,
            expires_at: now + 300,
          })

          const kb = buildInlineKeyboard(questionId, options, multiSelect)
          const text = formatQuestionText(args.question, args.header, options)

          try {
            const sent = await bot.api.sendMessage(chatId, text, {
              reply_markup: kb,
            })
            updatePendingQuestionMessageId(questionId, sent.message_id)
          } catch (err) {
            return {
              content: [{ type: 'text' as const, text: 'Failed to send question to Telegram. Proceed with your best judgment.' }],
            }
          }

          const answer = await new Promise<string>((resolve, reject) => {
            pendingResolvers.set(questionId, { resolve, reject })

            setTimeout(() => {
              if (pendingResolvers.has(questionId)) {
                pendingResolvers.delete(questionId)
                const q = getPendingQuestion(questionId)
                if (q?.message_id) {
                  bot.api.editMessageText(chatId, q.message_id, `${text}\n\n-- Question expiree (5min)`, {
                    reply_markup: undefined,
                  }).catch(() => {})
                }
                resolve('__timeout__')
              }
            }, QUESTION_TIMEOUT_MS)
          })

          pendingResolvers.delete(questionId)

          if (answer === '__timeout__') {
            return {
              content: [{ type: 'text' as const, text: 'User did not respond within 5 minutes. Proceed with your best judgment or ask again.' }],
            }
          }

          return {
            content: [{ type: 'text' as const, text: answer }],
          }
        }
      ),
    ],
  })

  return { server }
}

// -- Callback query handler ------------------------------------------------

export async function handleQuestionCallback(
  bot: Bot<Context>,
  action: CallbackAction,
  callbackQueryId: string
): Promise<void> {
  const q = getPendingQuestion(action.questionId)
  if (!q) return

  if (q.answered === 1) {
    await bot.api.answerCallbackQuery(callbackQueryId).catch(() => {})
    return
  }

  const options: QuestionOption[] = JSON.parse(q.options)

  if (action.action === 'select') {
    const chosen = options[action.index]
    if (!chosen) return

    answerPendingQuestion(q.id, chosen.label)

    if (q.message_id) {
      const text = formatQuestionText(q.question, q.header ?? undefined, options)
      await bot.api.editMessageText(q.chat_id, q.message_id, `${text}\n\n-> ${chosen.label}`, {
        reply_markup: undefined,
      }).catch(() => {})
    }

    const resolver = pendingResolvers.get(q.id)
    if (resolver) {
      resolver.resolve(chosen.label)
      pendingResolvers.delete(q.id)
    }
  } else if (action.action === 'toggle') {
    let selected: number[] = []
    try { selected = JSON.parse(q.selected) } catch { selected = [] }

    const idx = action.index
    if (selected.includes(idx)) {
      selected = selected.filter(i => i !== idx)
    } else {
      selected.push(idx)
    }

    updatePendingQuestionSelected(q.id, JSON.stringify(selected))

    const kb = new InlineKeyboard()
    for (let i = 0; i < options.length; i++) {
      const prefix = selected.includes(i) ? '-> ' : ''
      kb.text(`${prefix}${options[i].label}`, `q:${q.id}:t:${i}`)
      if (i % 2 === 1 || i === options.length - 1) kb.row()
    }
    kb.text('Autre', `q:${q.id}:other`)
    kb.text('Valider', `q:${q.id}:done`)
    kb.row()

    if (q.message_id) {
      const text = formatQuestionText(q.question, q.header ?? undefined, options)
      await bot.api.editMessageText(q.chat_id, q.message_id, text, {
        reply_markup: kb,
      }).catch(() => {})
    }
  } else if (action.action === 'done') {
    let selected: number[] = []
    try { selected = JSON.parse(q.selected) } catch { selected = [] }

    const chosenLabels = selected.map(i => options[i]?.label).filter(Boolean)
    const answer = JSON.stringify(chosenLabels)

    answerPendingQuestion(q.id, answer)

    if (q.message_id) {
      const text = formatQuestionText(q.question, q.header ?? undefined, options)
      await bot.api.editMessageText(q.chat_id, q.message_id, `${text}\n\n-> ${chosenLabels.join(', ')}`, {
        reply_markup: undefined,
      }).catch(() => {})
    }

    const resolver = pendingResolvers.get(q.id)
    if (resolver) {
      resolver.resolve(answer)
      pendingResolvers.delete(q.id)
    }
  } else if (action.action === 'other') {
    try {
      const sent = await bot.api.sendMessage(q.chat_id, 'Ecris ta reponse :', {
        reply_markup: { force_reply: true, selective: true },
      })
      pendingForceReplies.set(sent.message_id, q.id)
    } catch {
      // ignore
    }
  }

  await bot.api.answerCallbackQuery(callbackQueryId).catch(() => {})
}

// -- ForceReply handler ----------------------------------------------------

export function handleForceReply(
  questionId: string,
  answerText: string,
  bot: Bot<Context>,
): void {
  const q = getPendingQuestion(questionId)
  if (!q || q.answered === 1) return

  answerPendingQuestion(q.id, answerText)

  if (q.message_id) {
    const options: QuestionOption[] = JSON.parse(q.options)
    const text = formatQuestionText(q.question, q.header ?? undefined, options)
    bot.api.editMessageText(q.chat_id, q.message_id, `${text}\n\n-> ${answerText}`, {
      reply_markup: undefined,
    }).catch(() => {})
  }

  const resolver = pendingResolvers.get(q.id)
  if (resolver) {
    resolver.resolve(answerText)
    pendingResolvers.delete(q.id)
  }
}

// -- Expired questions cleanup ---------------------------------------------

export function cleanExpiredQuestions(bot: Bot<Context>): void {
  const expired = getExpiredQuestions()
  for (const q of expired) {
    if (q.message_id) {
      bot.api.editMessageText(q.chat_id, q.message_id, `${q.question}\n\n-- Question expiree`, {
        reply_markup: undefined,
      }).catch(() => {})
    }

    const resolver = pendingResolvers.get(q.id)
    if (resolver) {
      resolver.resolve('__timeout__')
      pendingResolvers.delete(q.id)
    }

    deletePendingQuestion(q.id)
  }
}

// -- Re-exports for convenience --------------------------------------------
export { parseCallbackData as parse } from './index.js'
export * from './db.js'
