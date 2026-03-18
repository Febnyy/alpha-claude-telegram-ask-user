import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

let db: Database.Database | null = null

export function getDb(dbPath?: string): Database.Database {
  if (!db) {
    const resolvedPath = dbPath ?? process.env.DB_PATH ?? path.join(process.cwd(), 'data.db')
    const dir = path.dirname(resolvedPath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    db = new Database(resolvedPath)
    db.pragma('journal_mode = WAL')
    db.exec(`
      CREATE TABLE IF NOT EXISTS pending_questions (
        id TEXT PRIMARY KEY,
        chat_id TEXT NOT NULL,
        message_id INTEGER,
        question TEXT NOT NULL,
        header TEXT,
        options TEXT NOT NULL,
        multi_select INTEGER DEFAULT 0,
        selected TEXT DEFAULT '[]',
        answered INTEGER DEFAULT 0,
        answer TEXT,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `)
  }
  return db
}

export interface PendingQuestion {
  id: string
  chat_id: string
  message_id: number | null
  question: string
  header: string | null
  options: string
  multi_select: number
  selected: string
  answered: number
  answer: string | null
  created_at: number
  expires_at: number
}

export function createPendingQuestion(q: {
  id: string
  chat_id: string
  message_id?: number | null
  question: string
  header?: string | null
  options: string
  multi_select: number
  created_at: number
  expires_at: number
}): void {
  getDb()
    .prepare(
      `INSERT INTO pending_questions (id, chat_id, message_id, question, header, options, multi_select, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(q.id, q.chat_id, q.message_id ?? null, q.question, q.header ?? null, q.options, q.multi_select, q.created_at, q.expires_at)
}

export function getPendingQuestion(id: string): PendingQuestion | undefined {
  return getDb()
    .prepare('SELECT * FROM pending_questions WHERE id = ?')
    .get(id) as PendingQuestion | undefined
}

export function answerPendingQuestion(id: string, answer: string): boolean {
  const q = getPendingQuestion(id)
  if (!q || q.answered === 1) return false
  getDb()
    .prepare('UPDATE pending_questions SET answered = 1, answer = ? WHERE id = ?')
    .run(answer, id)
  return true
}

export function updatePendingQuestionSelected(id: string, selected: string): void {
  getDb()
    .prepare('UPDATE pending_questions SET selected = ? WHERE id = ?')
    .run(selected, id)
}

export function updatePendingQuestionMessageId(id: string, messageId: number): void {
  getDb()
    .prepare('UPDATE pending_questions SET message_id = ? WHERE id = ?')
    .run(messageId, id)
}

export function getExpiredQuestions(): PendingQuestion[] {
  const now = Math.floor(Date.now() / 1000)
  return getDb()
    .prepare('SELECT * FROM pending_questions WHERE expires_at < ? AND answered = 0')
    .all(now) as PendingQuestion[]
}

export function deletePendingQuestion(id: string): void {
  getDb().prepare('DELETE FROM pending_questions WHERE id = ?').run(id)
}
