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
