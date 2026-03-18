import { randomBytes } from 'crypto'
import type { CallbackAction, InlineKeyboardMarkup, QuestionOption } from './types.js'

// -- Short ID generator ---------------------------------------------------

export function generateShortId(): string {
  return randomBytes(4).toString('hex') // 8 hex chars
}

// -- Callback data parser -------------------------------------------------

export function parseCallbackData(data: string): CallbackAction | null {
  if (!data.startsWith('q:')) return null

  const parts = data.split(':')
  if (parts.length < 3) return null
  const questionId = parts[1]
  if (!questionId) return null

  if (parts[2] === 'done') return { questionId, action: 'done' }
  if (parts[2] === 'other') return { questionId, action: 'other' }
  if (parts[2] === 't' && parts.length === 4) {
    const index = parseInt(parts[3]!, 10)
    if (isNaN(index)) return null
    return { questionId, action: 'toggle', index }
  }

  const index = parseInt(parts[2]!, 10)
  if (isNaN(index)) return null
  return { questionId, action: 'select', index }
}

// -- Keyboard builder ----------------------------------------------------

export function buildInlineKeyboard(
  questionId: string,
  options: QuestionOption[],
  multiSelect: boolean,
  selected: number[] = []
): InlineKeyboardMarkup {
  const rows: InlineKeyboardMarkup = []
  let currentRow: InlineKeyboardMarkup[0] = []

  for (let i = 0; i < options.length; i++) {
    const callbackData = multiSelect
      ? `q:${questionId}:t:${i}`
      : `q:${questionId}:${i}`

    const prefix = multiSelect && selected.includes(i) ? '-> ' : ''
    currentRow.push({ text: `${prefix}${options[i]!.label}`, callback_data: callbackData })

    // 2 buttons per row
    if (currentRow.length === 2 || i === options.length - 1) {
      rows.push(currentRow)
      currentRow = []
    }
  }

  // Action row
  const actionRow: InlineKeyboardMarkup[0] = [
    { text: 'Autre', callback_data: `q:${questionId}:other` },
  ]
  if (multiSelect) {
    actionRow.push({ text: 'Valider', callback_data: `q:${questionId}:done` })
  }
  rows.push(actionRow)

  return rows
}

// -- Question text formatter --------------------------------------------

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
