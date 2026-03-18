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
