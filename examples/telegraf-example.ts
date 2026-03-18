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
  options: {
    model: 'claude-opus-4-5',
    mcpServers: { 'telegram-ui': ui.server },
  },
})

console.log(response)

process.once('SIGTERM', () => { bot.stop('SIGTERM'); ui.destroy() })
