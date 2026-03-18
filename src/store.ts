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
