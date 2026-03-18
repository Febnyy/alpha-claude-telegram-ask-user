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
