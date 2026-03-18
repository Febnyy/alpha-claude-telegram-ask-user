# alpha-claude-telegram-ask-user

> **Alpha / WIP** -- bugs expected. MCP bridge that lets Claude agents ask Telegram users questions via inline keyboards.

Extracted from [ClaudeClaw](https://github.com/Febnyy/claudeclaw). No other open source project does this bridge: Claude Agent SDK `ask_user` tool -> Telegram inline keyboard -> promise resolves with user's answer.

## How it works

```
Claude agent calls ask_user tool
  -> MCP server sends Telegram message with inline keyboard
  -> User taps a button (or types free text via ForceReply)
  -> Bot callback_query handler resolves the promise
  -> Claude agent receives the answer and continues
```

5-minute timeout built in. Double-tap protection. Multi-select support.

## Install

```bash
npm install alpha-claude-telegram-ask-user
```

## Usage

```ts
import { Bot } from 'grammy'
import { query } from '@anthropic-ai/claude-agent-sdk'
import {
  createTelegramUiServer,
  parseCallbackData,
  handleQuestionCallback,
  handleForceReply,
  cleanExpiredQuestions,
  pendingForceReplies,
} from 'alpha-claude-telegram-ask-user'

const bot = new Bot(process.env.TELEGRAM_BOT_TOKEN!)
const chatId = process.env.TELEGRAM_CHAT_ID!

// 1. Create the MCP server
const { server } = createTelegramUiServer(bot, chatId)

// 2. Hook into your bot's callback_query handler
bot.on('callback_query:data', async (ctx) => {
  const action = parseCallbackData(ctx.callbackQuery.data)
  if (action) {
    await handleQuestionCallback(bot, action, ctx.callbackQuery.id)
    await ctx.answerCallbackQuery()
  }
})

// 3. Hook into ForceReply (free text via "Autre" option)
bot.on('message:text', async (ctx) => {
  if (ctx.message.reply_to_message) {
    const questionId = pendingForceReplies.get(ctx.message.reply_to_message.message_id)
    if (questionId) {
      pendingForceReplies.delete(ctx.message.reply_to_message.message_id)
      handleForceReply(questionId, ctx.message.text, bot)
      return
    }
  }
  // ... handle other messages
})

// 4. Clean expired questions periodically
setInterval(() => cleanExpiredQuestions(bot), 60_000)

// 5. Attach MCP server to Claude queries
const response = await query({
  prompt: 'Ask the user what they prefer.',
  model: 'claude-opus-4-5',
  mcpServers: [server],
})
```

## Known issues (alpha)

- Tested only with grammY bots
- `ask_user` blocks the agent turn until the user responds (or 5min timeout)
- No built-in retry on Telegram API errors
- ForceReply ("Autre") requires the user to explicitly reply to the bot message

## License

MIT
