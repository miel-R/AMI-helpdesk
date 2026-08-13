# Ami — Amertron Help Desk Bot

AI-powered Teams help desk bot ("Ami") with multi-department support, ticket creation, Taglish/English language mirroring, and administrator-controlled group chat access.

Built with TypeScript + Express, speaking the Bot Framework /v3 protocol directly (works with the Bot Framework Emulator).

## Features

- Multi-department support (IT, Engineering, HR, Manufacturing, Finance)
- AI-powered responses (Gemini, OpenAI, or Azure OpenAI — auto-detected)
- Conversational ticket creation and tracking
- Language mirroring: replies in the user's language (casual Taglish for Tagalog, English for English)
- Confidentiality guard: refuses sensitive topics (salaries, pricing, employee data, credentials, etc.)
- Group chat approval gate: silent in unapproved group chats until an administrator approves
- Runtime admin management via slash commands — no restarts needed
- Rate limiting, queueing, session management, caching, metrics

## Quick Start

```bash
npm install

# Configure keys + first-run access seeds (git-ignored)
# Edit env/.env.dev.user — see .env.example for all options

npm run dev
```

The bot listens on `http://localhost:3978`.

### Connect the Bot Framework Emulator

1. Open the emulator → **Open Bot**
2. Bot URL: `http://localhost:3978/api/messages`
3. Microsoft App ID / App Password: **leave blank** (the bot has no auth configured)
4. Set the **User ID** field (bottom of the chat window) — the emulator sends this as `from.id` (default is `default-user`)

The emulator channel responds to every message. In real Teams, Ami only responds when @-mentioned.

## Commands (users)

| Command | What it does |
|---|---|
| `/help` | Show the help message |
| `/status` | Show ticket info collected so far |
| `/reset` | Clear conversation history and start fresh |

Ami also ends the conversation on farewell words (`bye`, `goodbye`, `quit`, `exit`, `done`, `stop`, `see you`, `take care`, etc.).

## Commands (administrators)

Admin commands work in any chat — including unapproved group chats — and take effect immediately (no restart). Everything persists to `access-control.json`. Admins always bypass the allowlist.

| Command | What it does |
|---|---|
| `/allow <user-id>` | Add a user to the allowlist (who may trigger Ami) |
| `/disallow <user-id>` | Remove a user from the allowlist |
| `/allowlist` | List allowed users and admins |
| `/addadmin <user-id>` | Grant administrator rights (also auto-allows the user) |
| `/removeadmin <user-id>` | Revoke administrator rights |
| `/admins` | List administrators |
| `/approve` | Approve the current group chat (unlocks it) |
| `/restart` | Soft restart: clear sessions, reload flows and access lists |

Usage examples:

```
/allow 29:5ee40d54-a5fb-4db7-9f4b-4a8c367acb04
/addadmin 29:5ee40d54-a5fb-4db7-9f4b-4a8c367acb04
/approve
```

## Access Control (`access-control.json`)

Runtime access state is persisted to `access-control.json` (git-ignored) in the project root:

```json
{
  "allowedUserIds": ["default-user"],
  "adminUserIds": ["default-user"],
  "approvedConversations": [],
  "notified": []
}
```

- **First run**: the file is created and seeded from env vars (`ALLOWED_USER_IDS`, `ADMIN_USER_IDS`, `APPROVED_CONVERSATION_IDS`). After that, the JSON is the source of truth — edit it directly or use the admin commands.
- **Default-deny**: empty lists mean nobody is allowed (except admins). `allowedUserIds` empty but admins present = admins only.
- Delete the file to reset all access state (bot re-seeds from env on next start).

## Conversation Gating

### Group chats
- When Ami is added to a group chat that isn't approved, it posts a **single** "not approved by the administrator" notice, then stays silent.
- All messages in an unapproved GC are ignored until an admin sends `/approve` in that chat.
- Approved GCs behave normally (mention-only in Teams).

### Personal chats (1:1)
- Ami is only intended for group chats: in a 1:1 chat, a non-allowed user gets a **one-time** notice ("Ami only works inside approved group chats...") and is then silent forever in that chat.
- **Allowed users** (on the allowlist) and admins can chat with Ami normally in 1:1.
- In real Teams, allowed users don't need to @mention Ami in personal chats (mentions are only required in GCs and channels).

The bot can't prevent being added to a chat — it just refuses to operate until approved or allowed.

## Confidentiality & Language

- **Sensitive topics** are blocked before any AI call: salaries/sweldo/sahod, compensation, internal pricing/costs, employee personal data, credentials/API keys, unannounced projects/legal matters. Add more phrases via the `SENSITIVE_TOPICS` env var (comma-separated).
- **Language mirroring**: Ami matches the user's language — simple everyday Taglish for Tagalog speakers (never deep/formal Tagalog), natural English otherwise. Ticket collection questions follow the same rule.

## Configuration Reference

Loaded in order: `.env.dev` → `env/.env.dev` → `env/.env.dev.user` → `.env`. Secrets use a `SECRET_` prefix and live in the git-ignored `env/.env.dev.user`.

| Variable | Purpose | Default |
|---|---|---|
| `COMPANY_NAME` | Company name used in greetings | `Amertron Corporation` |
| `PORT` | HTTP port | `3978` |
| `AI_PROVIDER` | `auto` \| `gemini` \| `openai` \| `azure` | `auto` |
| `GEMINI_API_KEY` / `SECRET_GEMINI_API_KEY` | Gemini key | — |
| `GEMINI_MODEL_NAME` | Gemini model | `gemini-3.5-flash-lite` |
| `OPENAI_API_KEY` / `SECRET_OPENAI_API_KEY` | OpenAI key | — |
| `OPENAI_MODEL` | OpenAI model | `gpt-4o` |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI | — |
| `ALLOWED_USER_IDS` | First-run allowlist seed (comma-separated) | — |
| `ADMIN_USER_IDS` | First-run admins seed (comma-separated) | — |
| `APPROVED_CONVERSATION_IDS` | First-run approved GCs seed | — |
| `SENSITIVE_TOPICS` | Extra sensitive phrases to block | — |
| `TICKET_PREFIX` | Ticket ID prefix | `AMR` |
| `NOTIFY_ON_TICKET` | Ticket notification flag | `false` |
| `MAX_CONCURRENT`, `QUEUE_TIMEOUT`, `SESSION_TIMEOUT`, `RATE_LIMIT_WINDOW`, `MAX_REQUESTS_PER_WINDOW` | Performance tuning | see `.env.example` |
| `CACHE_TTL`, `MAX_CACHE_SIZE` | Response cache | `3600`, `1000` |
| `MAX_IMAGE_SIZE_MB`, `UPLOAD_DIR` | Image attachment handling | `10`, `./uploads` |

With no API key configured, the AI provider is `none` and Ami falls back to keyword-based rules.

## HTTP Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/messages` | Bot Framework message endpoint |
| `GET /api/health` | Health + metrics + departments |
| `GET /api/tickets` | All created tickets |

## Flows & Departments

- Flow definitions live in `src/flows/departments/<dept>/flow.json` + `rules.json` (keyword-based department detection)
- Adding a department requires: the `flow.json`, the `rules.json`, and an entry in the `departments` array in `src/config/config.ts`
- Ticket collection always asks 4 fields: `issue_type`, `description`, `urgency`, `department` (hard-coded in `src/core/agent.ts`)
- Flows are loaded from disk at startup — restart the bot after editing them

## Known Gotchas

- `npm start` / `package.json` `main` point to `lib/src/index.js`, which is never produced — the build emits to `dist/`. Run compiled app as `node dist/index.js`.
- Replies are posted with no auth token — works in the emulator, not real Teams (requires proper Bot Framework auth to be added).
- No test suite (`npm test` is a stub); `npm run build` (`tsc --build`) is the only verification.
