import { describe, it, expect } from 'vitest'
import {
  parseCallbackData,
  buildInlineKeyboard,
  formatQuestionText,
  generateShortId,
} from '../src/keyboard.js'
import type { QuestionOption } from '../src/types.js'

const opts: QuestionOption[] = [
  { label: 'Yes', description: 'Affirmative' },
  { label: 'No', description: 'Negative' },
]

describe('generateShortId', () => {
  it('returns 8 hex characters', () => {
    const id = generateShortId()
    expect(id).toMatch(/^[0-9a-f]{8}$/)
  })

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, generateShortId))
    expect(ids.size).toBe(100)
  })
})

describe('parseCallbackData', () => {
  it('returns null for non-question data', () => {
    expect(parseCallbackData('other:data')).toBeNull()
    expect(parseCallbackData('')).toBeNull()
  })

  it('parses single-select action', () => {
    expect(parseCallbackData('q:abc12345:0')).toEqual({
      questionId: 'abc12345',
      action: 'select',
      index: 0,
    })
  })

  it('parses toggle action', () => {
    expect(parseCallbackData('q:abc12345:t:1')).toEqual({
      questionId: 'abc12345',
      action: 'toggle',
      index: 1,
    })
  })

  it('parses done action', () => {
    expect(parseCallbackData('q:abc12345:done')).toEqual({
      questionId: 'abc12345',
      action: 'done',
    })
  })

  it('parses other action', () => {
    expect(parseCallbackData('q:abc12345:other')).toEqual({
      questionId: 'abc12345',
      action: 'other',
    })
  })

  it('returns null for malformed data', () => {
    expect(parseCallbackData('q:')).toBeNull()
    expect(parseCallbackData('q:abc')).toBeNull()
    expect(parseCallbackData('q:abc12345:notanumber')).toBeNull()
  })
})

describe('buildInlineKeyboard', () => {
  it('builds single-select keyboard with Autre button', () => {
    const kb = buildInlineKeyboard('qid1', opts, false)
    const flat = kb.flat()
    expect(flat.find(b => b.text === 'Yes')).toBeDefined()
    expect(flat.find(b => b.text === 'No')).toBeDefined()
    expect(flat.find(b => b.text === 'Autre')).toBeDefined()
    expect(flat.find(b => b.text === 'Valider')).toBeUndefined()
  })

  it('builds multi-select keyboard with Valider button', () => {
    const kb = buildInlineKeyboard('qid2', opts, true)
    const flat = kb.flat()
    expect(flat.find(b => b.text === 'Valider')).toBeDefined()
  })

  it('single-select callback_data uses select format', () => {
    const kb = buildInlineKeyboard('qid3', opts, false)
    const yesBtn = kb.flat().find(b => b.text === 'Yes')!
    expect(yesBtn.callback_data).toBe('q:qid3:0')
  })

  it('multi-select callback_data uses toggle format', () => {
    const kb = buildInlineKeyboard('qid4', opts, true)
    const yesBtn = kb.flat().find(b => b.text === 'Yes')!
    expect(yesBtn.callback_data).toBe('q:qid4:t:0')
  })

  it('prefixes selected items with -> in multi-select', () => {
    const kb = buildInlineKeyboard('qid5', opts, true, [0])
    const flat = kb.flat()
    const yesBtn = flat.find(b => b.text === '-> Yes')
    const noBtn = flat.find(b => b.text === 'No')
    expect(yesBtn).toBeDefined()
    expect(noBtn).toBeDefined()
  })

  it('does not prefix unselected items in multi-select', () => {
    const kb = buildInlineKeyboard('qid6', opts, true, [])
    const flat = kb.flat()
    expect(flat.find(b => b.text === '-> Yes')).toBeUndefined()
    expect(flat.find(b => b.text === 'Yes')).toBeDefined()
  })
})

describe('formatQuestionText', () => {
  it('formats with header', () => {
    const text = formatQuestionText('Pick one?', 'My Header', opts)
    expect(text).toContain('[My Header]')
    expect(text).toContain('Pick one?')
    expect(text).toContain('1. Yes -- Affirmative')
    expect(text).toContain('2. No -- Negative')
  })

  it('formats without header', () => {
    const text = formatQuestionText('Pick one?', undefined, opts)
    expect(text).not.toContain('[')
    expect(text).toContain('Pick one?')
  })
})
