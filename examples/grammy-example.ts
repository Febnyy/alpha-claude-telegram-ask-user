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
  options: {
    model: 'claude-opus-4-5',
    mcpServers: { 'telegram-ui': ui.server },
  },
})

console.log(response)

// Cleanup on exit
process.on('SIGTERM', () => ui.destroy())
