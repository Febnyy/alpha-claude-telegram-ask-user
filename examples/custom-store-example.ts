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
