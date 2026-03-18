# alpha-claude-telegram-ask-user Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the package from scratch to match the v4 design spec -- framework-agnostic adapter, in-memory store, clean public API, no circular imports, TypeScript strict.

**Architecture:** Six focused modules (types, store, keyboard, server, adapters, index) each with a single responsibility. Module-level resolver maps shared across the process. TelegramAdapter interface decouples grammY/Telegraf from core logic.

**Tech Stack:** TypeScript 5.5 (strict, ESM), Vitest (tests), @anthropic-ai/claude-agent-sdk (MCP), grammY + Telegraf (peer, optional), zod (schema validation)

**Spec:** `docs/specs/2026-03-18-design.md`

---

## Chunk 1: Project scaffold and shared types

### Task 1: Reset package.json and tsconfig

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`

- [ ] **Step 1.1: Rewrite package.json**

Replace the full file with:

```json
{
  "name": "alpha-claude-telegram-ask-user",
  "version": "0.1.0",
  "description": "MCP bridge: Claude Agent SDK ask_user tool -> Telegram inline keyboards",
  "type": "module",
  "main": "./dist/index.js",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "import": "./dist/index.js",
      "types": "./dist/index.d.ts"
    }
  },
  "scripts": {
    "build": "tsc",
    "test": "vitest run",
    "test:watch": "vitest",
    "dev": "tsc --watch"
  },
  "keywords": ["claude", "mcp", "telegram", "ask-user", "inline-keyboard", "grammy", "telegraf"],
  "license": "MIT",
  "dependencies": {
    "zod": "^3.23.0"
  },
  "peerDependencies": {
    "@anthropic-ai/claude-agent-sdk": ">=0.0.14",
    "grammy": ">=1.0.0",
    "telegraf": ">=4.0.0"
  },
  "peerDependenciesMeta": {
    "@anthropic-ai/claude-agent-sdk": { "optional": false },
    "grammy": { "optional": true },
    "telegraf": { "optional": true }
  },
  "devDependencies": {
    "@anthropic-ai/claude-agent-sdk": "^0.0.14",
    "@types/node": "^22.0.0",
    "grammy": "^1.31.0",
    "typescript": "^5.5.0",
    "vitest": "^2.0.0"
  }
}
```

- [ ] **Step 1.2: Rewrite tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
}
```

- [ ] **Step 1.3: Add vitest.config.ts**

Create `vitest.config.ts` at the repo root.

Note: With `"module": "NodeNext"` in tsconfig, TypeScript requires `.js` extensions in imports. Vitest does NOT use `tsc` to compile -- it transforms TypeScript inline. Without `resolve.extensionAlias`, Vitest will fail to find `.js` imports because the `.ts` source files do not have that extension. The `extensionAlias` config maps `.js` -> `.ts` during test runs so imports like `'../src/store.js'` resolve to `../src/store.ts`.

```ts
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    extensionAlias: {
      '.js': ['.ts', '.js'],
    },
  },
})
```

> **Note on zod:** `zod` is listed as a runtime `dependency` because it is used in `server.ts` for MCP tool schema validation. The spec's "no mandatory runtime deps" goal was aimed at removing `better-sqlite3` and forcing `grammy` as optional -- not achieving absolute zero deps. `zod` (~60kB minified) is acceptable for alpha.

- [ ] **Step 1.4: Install dependencies**

```bash
cd /tmp/alpha-claude-telegram-ask-user
npm install
```

Expected: no errors, `node_modules/@anthropic-ai/claude-agent-sdk` present.

- [ ] **Step 1.5: Commit scaffold**

```bash
git add package.json tsconfig.json vitest.config.ts
git commit -m "chore: reset scaffold -- peerDeps, vitest, remove better-sqlite3"
```

---

### Task 2: Write src/types.ts

**Files:**
- Create: `src/types.ts`

- [ ] **Step 2.1: Create src/types.ts**

```ts
// -- Framework-agnostic keyboard types ------------------------------------

export interface InlineButton {
  text: string
  callback_data: string
}

/** Rows of buttons. Each row is an array of buttons. */
export type InlineKeyboardMarkup = InlineButton[][]

// -- Telegram adapter interface -------------------------------------------

export interface TelegramAdapter {
  sendMessage(
    chatId: string,
    text: string,
    keyboard?: InlineKeyboardMarkup
  ): Promise<{ messageId: number }>

  editMessage(
    chatId: string,
    messageId: number,
    text: string,
    keyboard?: InlineKeyboardMarkup
  ): Promise<void>

  answerCallbackQuery(
    callbackQueryId: string,
    text?: string
  ): Promise<void>

  sendForceReply(
    chatId: string,
    promptText: string
  ): Promise<{ messageId: number }>
}

// -- Question option -------------------------------------------------------

export interface QuestionOption {
  label: string
  description: string
}

// -- Pending question (store entity) ---------------------------------------

export interface PendingQuestion {
  id: string
  chatId: string
  messageId: number | null
  question: string
  header: string | null
  options: QuestionOption[]
  multiSelect: boolean
  selected: number[]   // indices of toggled options (multi-select)
  answered: boolean
  createdAt: number    // unix seconds
  expiresAt: number    // unix seconds
}

// -- Callback action (parsed from callback_data string) --------------------

export type CallbackAction =
  | { questionId: string; action: 'select'; index: number }
  | { questionId: string; action: 'toggle'; index: number }
  | { questionId: string; action: 'done' }
  | { questionId: string; action: 'other' }

// -- Storage interface -----------------------------------------------------

export interface QuestionStore {
  set(id: string, question: PendingQuestion): Promise<void>
  get(id: string): Promise<PendingQuestion | undefined>
  delete(id: string): Promise<void>
  getExpired(now: number): Promise<PendingQuestion[]>
}

// -- Server factory options -----------------------------------------------

export interface TelegramUiOptions {
  timeoutMs?: number       // default: 300_000 (5 min)
  store?: QuestionStore    // default: InMemoryStore
}

// NOTE: TelegramUiServer is NOT defined here to avoid coupling types.ts to the SDK.
// It is derived in server.ts via:
//   export type TelegramUiServer = ReturnType<typeof createTelegramUiServer>
// index.ts re-exports it from server.ts, not from types.ts.
```

- [ ] **Step 2.2: Commit types**

```bash
git add src/types.ts
git commit -m "feat: add shared types (TelegramAdapter, QuestionStore, PendingQuestion, etc.)"
```

---

## Chunk 2: InMemoryStore

### Task 3: Write tests for InMemoryStore

**Files:**
- Create: `tests/store.test.ts`
- Create: `src/store.ts`

- [ ] **Step 3.1: Write failing tests**

Create `tests/store.test.ts`:

```ts
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
```

- [ ] **Step 3.2: Run tests -- expect FAIL**

```bash
cd /tmp/alpha-claude-telegram-ask-user
npx vitest run tests/store.test.ts
```

Expected: FAIL with `Cannot find module '../src/store.js'`

- [ ] **Step 3.3: Implement src/store.ts**

Create `src/store.ts`:

```ts
import type { PendingQuestion, QuestionStore } from './types.js'

export class InMemoryStore implements QuestionStore {
  private readonly map = new Map<string, PendingQuestion>()

  async set(id: string, question: PendingQuestion): Promise<void> {
    this.map.set(id, question)
  }

  async get(id: string): Promise<PendingQuestion | undefined> {
    return this.map.get(id)
  }

  async delete(id: string): Promise<void> {
    this.map.delete(id)
  }

  async getExpired(now: number): Promise<PendingQuestion[]> {
    const result: PendingQuestion[] = []
    for (const q of this.map.values()) {
      if (q.expiresAt < now && !q.answered) {
        result.push(q)
      }
    }
    return result
  }
}
```

- [ ] **Step 3.4: Run tests -- expect PASS**

```bash
npx vitest run tests/store.test.ts
```

Expected: 7 tests pass.

- [ ] **Step 3.5: Commit**

```bash
git add src/store.ts tests/store.test.ts
git commit -m "feat: InMemoryStore with QuestionStore interface"
```

---

## Chunk 3: Keyboard utilities

### Task 4: Write tests for keyboard.ts

**Files:**
- Create: `tests/keyboard.test.ts`
- Create: `src/keyboard.ts`

- [ ] **Step 4.1: Write failing tests**

Create `tests/keyboard.test.ts`:

```ts
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
    // Two option buttons + Autre
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
    // Option index 0 (Yes) is toggled on
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
```

- [ ] **Step 4.2: Run tests -- expect FAIL**

```bash
npx vitest run tests/keyboard.test.ts
```

Expected: FAIL with `Cannot find module '../src/keyboard.js'`

- [ ] **Step 4.3: Implement src/keyboard.ts**

Create `src/keyboard.ts`:

```ts
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
    const index = parseInt(parts[3], 10)
    if (isNaN(index)) return null
    return { questionId, action: 'toggle', index }
  }

  const index = parseInt(parts[2], 10)
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
    currentRow.push({ text: `${prefix}${options[i].label}`, callback_data: callbackData })

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
```

- [ ] **Step 4.4: Run tests -- expect PASS**

```bash
npx vitest run tests/keyboard.test.ts
```

Expected: all tests pass.

- [ ] **Step 4.5: Commit**

```bash
git add src/keyboard.ts tests/keyboard.test.ts
git commit -m "feat: keyboard utilities (buildInlineKeyboard, parseCallbackData, formatQuestionText)"
```

---

## Chunk 4: MCP server factory

### Task 5: Write tests for server.ts

**Files:**
- Create: `tests/server.test.ts`
- Create: `src/server.ts`

- [ ] **Step 5.1: Create a mock TelegramAdapter helper**

Add this to the top of `tests/server.test.ts` (create the file):

```ts
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
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
```

- [ ] **Step 5.2: Write tests for ask_user validation**

Continue in `tests/server.test.ts`:

```ts
// -- Helper: call ask_user tool directly via MCP server -------------------
// The MCP server exposes tools via the SDK. We test the tool handler logic
// by calling createTelegramUiServer and inspecting side effects.

describe('createTelegramUiServer', () => {
  let adapter: ReturnType<typeof makeMockAdapter>
  let store: InMemoryStore

  beforeEach(() => {
    adapter = makeMockAdapter()
    store = new InMemoryStore()
  })

  afterEach(() => {
    // Clean up any intervals
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
    // answerCallbackQuery called once, no edit
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
    // No crash, no side effects
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
```

- [ ] **Step 5.3: Run tests -- expect FAIL**

```bash
npx vitest run tests/server.test.ts
```

Expected: FAIL with `Cannot find module '../src/server.js'`

- [ ] **Step 5.4: Implement src/server.ts**

Create `src/server.ts`:

```ts
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
  handleForceReplyMessage(replyToMessageId: number, answerText: string): Promise<void>
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

    // Wait for answer (resolved by handleCallbackQuery or cleanup interval)
    const answer = await new Promise<string>((resolve) => {
      pendingResolvers.set(questionId, resolve)

      setTimeout(async () => {
        if (pendingResolvers.has(questionId)) {
          pendingResolvers.delete(questionId)
          const q = await store.get(questionId)
          if (q?.messageId) {
            adapter.editMessage(chatId, q.messageId, `${text}\n\n-- Question expiree`).catch(() => {})
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
        // Invalid index (unreachable in normal flow, but answer the query to avoid spinner)
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

  async function handleForceReplyMessage(replyToMessageId: number, answerText: string): Promise<void> {
    const questionId = pendingForceReplies.get(replyToMessageId)
    if (!questionId) return

    pendingForceReplies.delete(replyToMessageId)

    const q = await store.get(questionId)
    if (!q || q.answered) return

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
```

- [ ] **Step 5.5: Run all tests -- expect PASS**

```bash
npx vitest run
```

Expected: all tests in store, keyboard, and server pass.

- [ ] **Step 5.6: Commit**

```bash
git add src/server.ts tests/server.test.ts
git commit -m "feat: createTelegramUiServer MCP factory with callback and ForceReply handlers"
```

---

## Chunk 5: Adapters

### Task 6: grammY adapter

**Files:**
- Create: `src/adapters/grammy.ts`

- [ ] **Step 6.1: Create src/adapters/grammy.ts**

```ts
import type { Bot, Context } from 'grammy'
import type { TelegramAdapter, InlineKeyboardMarkup } from '../types.js'

export function createGrammyAdapter(bot: Bot<Context>): TelegramAdapter {
  return {
    async sendMessage(chatId, text, keyboard) {
      const reply_markup = keyboard ? { inline_keyboard: keyboard } : undefined
      const msg = await bot.api.sendMessage(chatId, text, { reply_markup })
      return { messageId: msg.message_id }
    },

    async editMessage(chatId, messageId, text, keyboard) {
      // Pass `{ inline_keyboard: [] }` (not `undefined`) to actively remove the keyboard.
      // Passing `reply_markup: undefined` is dropped by JSON.stringify and Telegram
      // preserves the existing keyboard -- which is NOT the desired behavior on resolve/timeout.
      const reply_markup = keyboard
        ? { inline_keyboard: keyboard }
        : { inline_keyboard: [] as InlineKeyboardMarkup }
      await bot.api.editMessageText(chatId, messageId, text, { reply_markup })
    },

    async answerCallbackQuery(callbackQueryId, text) {
      await bot.api.answerCallbackQuery(callbackQueryId, { text })
    },

    async sendForceReply(chatId, promptText) {
      const msg = await bot.api.sendMessage(chatId, promptText, {
        reply_markup: { force_reply: true, selective: true },
      })
      return { messageId: msg.message_id }
    },
  }
}
```

- [ ] **Step 6.2: Create src/adapters/telegraf.ts**

```ts
import type { Telegraf, Context } from 'telegraf'
import type { TelegramAdapter, InlineKeyboardMarkup } from '../types.js'

export function createTelegrafAdapter(bot: Telegraf<Context>): TelegramAdapter {
  return {
    async sendMessage(chatId, text, keyboard) {
      const reply_markup = keyboard ? { inline_keyboard: keyboard } : undefined
      const msg = await bot.telegram.sendMessage(chatId, text, { reply_markup })
      return { messageId: msg.message_id }
    },

    async editMessage(chatId, messageId, text, keyboard) {
      // Same fix as grammY adapter: use `{ inline_keyboard: [] }` to remove keyboard.
      // Telegraf v4 editMessageText signature: (chat_id, message_id, inline_message_id, text, extra?)
      const reply_markup = keyboard
        ? { inline_keyboard: keyboard }
        : { inline_keyboard: [] as InlineKeyboardMarkup }
      await bot.telegram.editMessageText(chatId, messageId, undefined, text, { reply_markup })
    },

    async answerCallbackQuery(callbackQueryId, text) {
      await bot.telegram.answerCbQuery(callbackQueryId, text)
    },

    async sendForceReply(chatId, promptText) {
      const msg = await bot.telegram.sendMessage(chatId, promptText, {
        reply_markup: { force_reply: true, selective: true },
      })
      return { messageId: msg.message_id }
    },
  }
}
```

- [ ] **Step 6.3: Run all tests -- still passing**

```bash
npx vitest run
```

Expected: all tests pass (adapters have no unit tests -- they are thin wrappers over Telegram APIs).

- [ ] **Step 6.4: Commit**

```bash
git add src/adapters/
git commit -m "feat: grammY and Telegraf adapters"
```

---

## Chunk 6: Public API, examples, and build verification

### Task 7: Clean public API in index.ts

**Files:**
- Modify: `src/index.ts`

- [ ] **Step 7.1: Rewrite src/index.ts (no logic, clean re-exports)**

```ts
// Public API
export { createTelegramUiServer } from './server.js'
export { InMemoryStore } from './store.js'
export { createGrammyAdapter } from './adapters/grammy.js'
export { createTelegrafAdapter } from './adapters/telegraf.js'
export { parseCallbackData, buildInlineKeyboard, formatQuestionText, generateShortId } from './keyboard.js'

// Types from types.ts
export type {
  TelegramAdapter,
  TelegramUiOptions,
  QuestionStore,
  QuestionOption,
  PendingQuestion,
  InlineButton,
  InlineKeyboardMarkup,
  CallbackAction,
} from './types.js'

// TelegramUiServer lives in server.ts (defined alongside its implementation)
export type { TelegramUiServer } from './server.js'
```

- [ ] **Step 7.2: Delete src/db.ts (replaced by store.ts)**

```bash
rm /tmp/alpha-claude-telegram-ask-user/src/db.ts
```

- [ ] **Step 7.3: Verify no circular imports**

```bash
npx vitest run
```

Expected: all tests pass, no circular import errors.

- [ ] **Step 7.4: Commit**

```bash
git add src/index.ts
git rm src/db.ts
git commit -m "feat: clean public API in index.ts, remove legacy db.ts"
```

---

### Task 8: Write examples

**Files:**
- Create: `examples/grammy-example.ts`
- Create: `examples/telegraf-example.ts`
- Create: `examples/custom-store-example.ts`

- [ ] **Step 8.1: Create examples/grammy-example.ts**

```ts
/**
 * grammY example -- ask_user via inline keyboard
 *
 * Prerequisites:
 *   npm install grammy @anthropic-ai/claude-agent-sdk
 *
 * Environment variables:
 *   TELEGRAM_BOT_TOKEN=...
 *   TELEGRAM_CHAT_ID=...
 *   ANTHROPIC_API_KEY=...
 */

import { Bot } from 'grammy'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  createTelegramUiServer,
  createGrammyAdapter,
} from 'alpha-claude-telegram-ask-user'

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)
const chatId = process.env.TELEGRAM_CHAT_ID!

const adapter = createGrammyAdapter(bot)
const ui = createTelegramUiServer(adapter, chatId, { timeoutMs: 5 * 60_000 })

// Hook into callback queries (button taps)
bot.on('callback_query:data', async (ctx) => {
  await ui.handleCallbackQuery(ctx.callbackQuery.data, ctx.callbackQuery.id)
})

// Hook into ForceReply (free text via "Autre")
bot.on('message:text', async (ctx) => {
  if (ctx.message.reply_to_message) {
    await ui.handleForceReplyMessage(ctx.message.reply_to_message.message_id, ctx.message.text)
  }
})

bot.start()

// Example: ask the user a question from a Claude agent
const response = await query({
  prompt: 'Ask the user whether they want a summary or the full report.',
  model: 'claude-opus-4-5',
  mcpServers: { 'telegram-ui': ui.server },
})

console.log(response)

// Cleanup on exit
process.on('SIGTERM', () => ui.destroy())
```

- [ ] **Step 8.2: Create examples/telegraf-example.ts**

```ts
/**
 * Telegraf example -- ask_user via inline keyboard
 */

import { Telegraf } from 'telegraf'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  createTelegramUiServer,
  createTelegrafAdapter,
} from 'alpha-claude-telegram-ask-user'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)
const chatId = process.env.TELEGRAM_CHAT_ID!

const adapter = createTelegrafAdapter(bot)
const ui = createTelegramUiServer(adapter, chatId)

bot.on('callback_query', async (ctx) => {
  if ('data' in ctx.callbackQuery) {
    await ui.handleCallbackQuery(ctx.callbackQuery.data, ctx.callbackQuery.id)
  }
})

bot.on('message', async (ctx) => {
  if ('text' in ctx.message && ctx.message.reply_to_message) {
    await ui.handleForceReplyMessage(ctx.message.reply_to_message.message_id, ctx.message.text)
  }
})

bot.launch()

const response = await query({
  prompt: 'Ask the user to choose between option A or option B.',
  model: 'claude-opus-4-5',
  mcpServers: { 'telegram-ui': ui.server },
})

console.log(response)

process.once('SIGTERM', () => { bot.stop('SIGTERM'); ui.destroy() })
```

- [ ] **Step 8.3: Create examples/custom-store-example.ts**

```ts
/**
 * Custom store example -- inject your own SQLite store
 *
 * Shows how to implement QuestionStore with better-sqlite3.
 */

import Database from 'better-sqlite3'
import type { QuestionStore, PendingQuestion } from 'alpha-claude-telegram-ask-user'
import { createTelegramUiServer, createGrammyAdapter } from 'alpha-claude-telegram-ask-user'
import { Bot } from 'grammy'

// -- Custom SQLite store --------------------------------------------------

class SqliteStore implements QuestionStore {
  private db: Database.Database

  constructor(dbPath: string) {
    this.db = new Database(dbPath)
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS pending_questions (
        id TEXT PRIMARY KEY,
        data TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        answered INTEGER DEFAULT 0
      )
    `)
  }

  async set(id: string, question: PendingQuestion): Promise<void> {
    this.db
      .prepare('INSERT OR REPLACE INTO pending_questions (id, data, expires_at, answered) VALUES (?, ?, ?, ?)')
      .run(id, JSON.stringify(question), question.expiresAt, question.answered ? 1 : 0)
  }

  async get(id: string): Promise<PendingQuestion | undefined> {
    const row = this.db.prepare('SELECT data FROM pending_questions WHERE id = ?').get(id) as { data: string } | undefined
    if (!row) return undefined
    return JSON.parse(row.data) as PendingQuestion
  }

  async delete(id: string): Promise<void> {
    this.db.prepare('DELETE FROM pending_questions WHERE id = ?').run(id)
  }

  async getExpired(now: number): Promise<PendingQuestion[]> {
    const rows = this.db
      .prepare('SELECT data FROM pending_questions WHERE expires_at < ? AND answered = 0')
      .all(now) as { data: string }[]
    return rows.map(r => JSON.parse(r.data) as PendingQuestion)
  }
}

// -- Usage ----------------------------------------------------------------

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)
const chatId = process.env.TELEGRAM_CHAT_ID!
const store = new SqliteStore('./questions.db')
const adapter = createGrammyAdapter(bot)

const ui = createTelegramUiServer(adapter, chatId, { store })

bot.on('callback_query:data', async (ctx) => {
  await ui.handleCallbackQuery(ctx.callbackQuery.data, ctx.callbackQuery.id)
})

bot.start()
```

- [ ] **Step 8.4: Commit examples**

```bash
git add examples/
git commit -m "docs: add grammy, telegraf, and custom-store examples"
```

---

### Task 9: Build verification and final push

**Files:**
- Modify: `src/types.ts` (fix McpServer type if needed)

- [ ] **Step 9.1: Run full test suite**

```bash
npx vitest run
```

Expected: all tests pass.

- [ ] **Step 9.2: TypeScript build**

```bash
npm run build
```

Expected: no TypeScript errors, `dist/` folder created with `.js` + `.d.ts` files.

If errors appear, fix them before proceeding. Common issues:
- Import missing `.js` extension in ESM imports -- add `.js` to all relative imports
- `McpServer` type -- use `ReturnType<typeof createSdkMcpServer>` if the SDK doesn't export the type directly

- [ ] **Step 9.2b: Create tsconfig.examples.json**

The examples import from `'alpha-claude-telegram-ask-user'` (bare specifier). A `paths` mapping points it to the local `dist/` build. Create `tsconfig.examples.json`:

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "noEmit": true,
    "paths": {
      "alpha-claude-telegram-ask-user": ["./src/index.ts"]
    }
  },
  "include": ["examples/**/*"]
}
```

- [ ] **Step 9.2c: Type-check examples (requires build from Step 9.2 first)**

```bash
npx tsc --project tsconfig.examples.json
```

Expected: no errors. If errors appear, fix the example files. Common issue: `model` string -- use `'claude-opus-4-5'` or whatever is currently valid (the SDK types `model` as `string`, not a union, so this will not fail type-check).

- [ ] **Step 9.3: Verify no circular imports**

```bash
node --input-type=module <<'EOF'
import './dist/index.js'
console.log('No circular imports')
EOF
```

Expected: `No circular imports` printed, no errors.

- [ ] **Step 9.4: Update README with correct usage**

Update the `## Usage` section in `README.md` to reflect the new API (`createGrammyAdapter`, `ui.handleCallbackQuery`, `ui.handleForceReplyMessage`, `ui.destroy()`). Remove references to old functions (`parseCallbackData`, `handleQuestionCallback`, `pendingForceReplies`).

- [ ] **Step 9.5: Final commit and push**

```bash
GITHUB_TOKEN=$(grep GITHUB_TOKEN /opt/claudeclaw/.env | cut -d= -f2)
cd /tmp/alpha-claude-telegram-ask-user
git add -A
git commit -m "feat: complete rewrite -- adapter pattern, in-memory store, clean public API

- TelegramAdapter interface (framework-agnostic)
- InMemoryStore (default, no deps)
- grammY and Telegraf adapters
- createTelegramUiServer returns { server, handleCallbackQuery, handleForceReplyMessage, destroy }
- No circular imports, TypeScript strict, zero mandatory runtime deps

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
git remote set-url origin https://Febnyy:${GITHUB_TOKEN}@github.com/Febnyy/alpha-claude-telegram-ask-user.git
git push origin main
```

Expected: push succeeds, visible at https://github.com/Febnyy/alpha-claude-telegram-ask-user

---
