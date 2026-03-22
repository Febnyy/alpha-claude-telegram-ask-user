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
# peer dep -- pick one:
npm install grammy        # grammY adapter
npm install telegraf      # Telegraf adapter
```

## Usage (grammY)

```ts
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

// Attach MCP server to Claude queries
const response = await query({
  prompt: 'Ask the user what they prefer.',
  options: {
    model: 'claude-opus-4-5',
    mcpServers: { 'telegram-ui': ui.server },
  },
})

// Cleanup on exit
process.on('SIGTERM', () => ui.destroy())
```

## Usage (Telegraf)

```ts
import { Telegraf } from 'telegraf'
import { createTelegramUiServer, createTelegrafAdapter } from 'alpha-claude-telegram-ask-user'

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN!)
const adapter = createTelegrafAdapter(bot)
const ui = createTelegramUiServer(adapter, chatId)

bot.on('callback_query', async (ctx) => {
  if ('data' in ctx.callbackQuery) {
    await ui.handleCallbackQuery(ctx.callbackQuery.data, ctx.callbackQuery.id)
  }
})
```

## Custom store (Redis, SQLite, etc.)

Inject your own store via the `store` option:

```ts
import type { QuestionStore, PendingQuestion } from 'alpha-claude-telegram-ask-user'

class MyStore implements QuestionStore {
  async set(id: string, q: PendingQuestion) { /* ... */ }
  async get(id: string) { /* ... */ }
  async delete(id: string) { /* ... */ }
  async getExpired(now: number) { /* ... */ }
}

const ui = createTelegramUiServer(adapter, chatId, { store: new MyStore() })
```

See `examples/custom-store-example.ts` for a full SQLite implementation.

## API

### `createTelegramUiServer(adapter, chatId, options?)`

Returns `{ server, handleCallbackQuery, handleForceReplyMessage, destroy }`.

- `server` -- MCP server to pass to `query({ options: { mcpServers } })`
- `handleCallbackQuery(data, callbackQueryId)` -- call from your bot's callback_query handler
- `handleForceReplyMessage(replyToMessageId, text)` -- call from your bot's message handler
- `destroy()` -- clears timers and in-flight state on shutdown

### `createGrammyAdapter(bot)` / `createTelegrafAdapter(bot)`

Wrap your bot instance into the framework-agnostic `TelegramAdapter`.

### `InMemoryStore`

Default store. No external dependencies.

## Critical gotchas

### 1. grammY SequentialRunner deadlock

grammY's default `SequentialRunner` blocks ALL update fetching while a handler is running. If your `message:text` handler awaits the agent run, `callback_query` updates (button clicks) are never fetched, causing a deadlock: the agent waits for a button click that can never arrive.

**Fix:** Do NOT await the agent call inside your message handler. Use fire-and-forget:

```ts
bot.on('message:text', async (ctx) => {
  // DO NOT: await runAgent(...)
  // DO: fire-and-forget so grammY keeps polling for callback_query updates
  runAgent(ctx.message.text, { mcpServers: { 'telegram-ui': ui.server } })
    .catch(err => console.error('agent error', err))
})
```

### 2. Stream close timeout

The Claude Code SDK has a default stream close timeout (~60s). If the user takes longer to respond, the stream closes with "Tool permission stream closed before response received".

**Fix:** Set the env var before importing the SDK:

```ts
process.env.CLAUDE_CODE_STREAM_CLOSE_TIMEOUT = '300000' // 5 minutes
```

## Known issues (alpha)

- One `createTelegramUiServer` instance per process (module-level resolver maps)
- `ask_user` blocks the agent turn until the user responds (or timeout)
- No built-in retry on Telegram API errors
- ForceReply ("Autre") requires the user to explicitly reply to the bot message

## License

MIT
