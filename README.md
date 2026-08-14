# Ami — Amertron Help Desk Bot

AI-powered Microsoft Teams help desk bot ("Ami") with multi-department support, automatic photo analysis, conversational ticket creation, Taglish/English language mirroring, and administrator-controlled group chat access.

Built with TypeScript + Express, speaking the Bot Framework /v3 protocol directly (works with the Bot Framework Emulator and real Teams).

## Features

- **Multi-department support** — IT, Engineering, HR, Manufacturing, Finance
- **AI-powered responses** — Gemini, OpenAI, or Azure OpenAI (auto-detected)
- **Photo / screenshot analysis** — users can attach images and Ami diagnoses the problem (e.g. a black screen) before opening a ticket
- **Conversational ticket creation** and tracking
- **Always tells you who it's talking to** — every reply in a group chat mentions the recipient (`<at>Name</at>`) and Ami knows the user's name
- **Language mirroring** — casual Taglish for Tagalog speakers, natural English otherwise
- **Confidentiality guard** — refuses sensitive topics (salaries, pricing, employee data, credentials, etc.) before any AI call
- **Group chat approval gate** — silent in unapproved group chats until an administrator approves
- **Crisis alerting** — emergency-level issues page the Help Desk admins (registered group chat + each admin's 1:1) instead of getting buried in tickets
- **Runtime admin management** via slash commands — no restarts needed
- **Secure for production** — Teams JWT validation on inbound messages, signed bot tokens on outbound replies and image downloads
- Rate limiting, queueing, session management, caching, metrics

## Quick Start

```bash
npm install

# Configure AI keys + first-run access seeds (git-ignored)
# Edit env/.env.dev.user — see .env.example for all options

npm run dev
```

The bot listens on `http://localhost:3978`.

For a production-style run:

```bash
npm run build        # tsc --build + copies src/flows into dist/
node dist/index.js
```

## Connect the Bot Framework Emulator

1. Open the emulator → **Open Bot**
2. Bot URL: `http://localhost:3978/api/messages`
3. **Microsoft App ID / App Password**: leave blank if no `BOT_ID`/`BOT_PASSWORD` are configured (local development). If you run `npm run dev:teamsfx` (which loads `.localConfigs` with real bot creds), supply the matching App ID / Password.
4. Optionally edit the emulator **User** profile (Settings → User) to a real name — Ami uses `from.name` for mentions, so this is how you'll see real-name mentions locally.

> Note: the emulator/test-channel bypass (no auth, no mention, no approval) only applies to traffic that originates from the local machine (loopback). A remote caller spoofing `channelId: "emulator"` still must pass real JWT validation and the access gates.

The emulator channel responds to every message. In real Teams, Ami only responds when @-mentioned in group chats.

## Commands (users)

| Command | What it does |
|---|---|
| `/help` | Show the help message (same for everyone; admins see their command list via `/admin`) |
| `/admin` | Admins: confirm permission + full admin command list. Non-admins: pointed to `/help` |
| `/status` | Show ticket info collected so far |
| `/reset` | Clear conversation history and start fresh |
| `/end` | End the conversation (also `/exit`, `/quit`) |

Ami also ends the conversation on farewell words (`bye`, `goodbye`, `quit`, `exit`, `done`, `stop`, `see you`, `take care`, etc.).

## Commands (administrators)

Admin commands work in any chat — including unapproved group chats — and take effect immediately (no restart). Everything persists to `access-control.json`. Admins always bypass the allowlist.

| Command | What it does |
|---|---|
| `/admin` | Confirm admin permission + show the full admin command list |
| `/help` | Show the shared user help message (same as everyone) |
| `/allow <user-id>` | Add a user to the allowlist (who may trigger Ami) |
| `/disallow <user-id>` | Remove a user from the allowlist |
| `/allowlist` | List allowed users and admins |
| `/addadmin <user-id>` | Grant administrator rights (also auto-allows the user) |
| `/removeadmin <user-id>` | Revoke administrator rights |
| `/admins` | List administrators |
| `/approve` | Approve the current group chat (unlocks it) |
| `/restart` | Soft restart: clear sessions, reload flows, access and alert config |
| `/alert [status\|on\|off\|mode both\|gc\|1to1\|gcon\|test]` | Manage Help Desk issue alerts (crisis alerts to admin GC + admin 1:1 chats) |

Usage examples:

```
/allow 29:5ee40d54-a5fb-4db7-9f4b-4a8c367acb04
/addadmin 29:5ee40d54-a5fb-4db7-9f4b-4a8c367acb04
/approve
```

## Help Desk Alerts

When an incoming message is judged high-priority/emergency (AI verdict, or keyword rules when no AI key is configured), Ami skips ticket collection and fires a **Help Desk Alert** instead:

- **Admin group chat** — the chat registered via `/alert gcon` receives the alert (persisted in `alert-config.json`, git-ignored).
- **Admin 1:1 chats** — every administrator who has ever messaged Ami gets a private alert. These refs are in-memory: after a bot restart, each admin sends one message (any command works) to re-register.
- **Reporter reply** — the person who reported the issue gets a confirmation that the Help Desk has been alerted.
- **Dedupe** — the same reporter is re-alerted at most once per `dedupeMinutes` (default 10) to prevent spam.

Manage it with `/alert` (admin-only): `status`, `on`, `off`, `mode both|gc|1to1`, `gcon`, `test`. With `ENABLE_TICKETS=false` (default), issues produce alerts rather than tickets.

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
- Alert channel state lives in its own runtime file, `alert-config.json` (also git-ignored), managed via `/alert`.

## Conversation Gating

### Group chats
- When Ami is added to a group chat that isn't approved, it posts a **single** "not approved by the administrator" notice, then stays silent.
- All messages in an unapproved GC are ignored until an admin sends `/approve` in that chat.
- Approved GCs behave normally (mention-only in Teams).

### Personal chats (1:1)
- Ami is primarily for group chats: in a 1:1 chat, a non-allowed user gets a **one-time** notice ("Ami only works inside approved group chats...") and is then silent in that chat.
- **Allowed users** (on the allowlist) and admins can chat with Ami normally in 1:1.
- In real Teams, allowed users don't need to @mention Ami in personal chats (mentions are only required in GCs and channels).

The bot can't prevent being added to a chat — it just refuses to operate until approved or allowed.

## Mentions & Identity

- Every reply is addressed to the person Ami is talking to. In group chats this matters most: with several users chatting, each reply is tagged with the correct recipient.
- Format: a real Bot Framework **mention entity** (`<at>Name</at>` + `entities[].type = "mention"`) so Teams renders it highlighted. Falls back to a plain `@Name`/`@id` prefix when a name isn't available.
- Ami is also told who it's talking to, so replies can naturally use the user's name.

## Photo / Screenshot Support

- Attach any image (JPEG, PNG, GIF, WebP, BMP) up to `MAX_IMAGE_SIZE_MB` and Ami analyzes it with the AI — e.g. a photo of a black screen becomes a diagnosis plus a ticket.
- Images land in `UPLOAD_DIR` (default: OS temp `/ami-uploads`) and are never stored in the repo.
- A known Gemini quirk: multi-turn history causes the model to lose the attached image, so image messages are sent to the AI as a single turn (system prompt + image). Verified live against the API.
- In real Teams, attachment downloads use the bot's bearer token (Teams returns 403 without it).

## Confidentiality & Language

- **Sensitive topics** are blocked before any AI call: salaries/sweldo/sahod, compensation, internal pricing/costs, employee personal data, credentials/API keys, unannounced projects/legal matters. Add more phrases via the `SENSITIVE_TOPICS` env var (comma-separated).
- **Language mirroring**: Ami matches the user's language — simple everyday Taglish for Tagalog speakers (never deep/formal Tagalog), natural English otherwise. Ticket collection questions follow the same rule.

## Configuration Reference

Loaded in order: `.env.dev` → `env/.env.dev` → `env/.env.dev.user` → `.env`. Secrets use a `SECRET_` prefix and live in the git-ignored `env/.env.dev.user`.

| Variable | Purpose | Default |
|---|---|---|
| `COMPANY_NAME` | Company name used in greetings | `Amertron Corporation` |
| `PORT` | HTTP port | `3978` |
| `NODE_ENV` | `development` \| `production` | `development` |
| `AI_PROVIDER` | `auto` \| `gemini` \| `openai` \| `azure` | `auto` |
| `GEMINI_API_KEY` / `SECRET_GEMINI_API_KEY` | Gemini key | — |
| `GEMINI_MODEL_NAME` | Gemini model | `gemini-3.5-flash-lite` |
| `OPENAI_API_KEY` / `SECRET_OPENAI_API_KEY` | OpenAI key | — |
| `OPENAI_MODEL` | OpenAI model | `gpt-4o` |
| `AZURE_OPENAI_ENDPOINT` / `AZURE_OPENAI_KEY` / `AZURE_OPENAI_DEPLOYMENT` | Azure OpenAI | — |
| `BOT_ID` / `SECRET_BOT_PASSWORD` | Bot Framework app ID / client secret (auth) | — |
| `BOT_ENDPOINT` | Bot messaging endpoint URL (info only) | — |
| `ALLOWED_USER_IDS` | First-run allowlist seed (comma-separated) | — |
| `ADMIN_USER_IDS` | First-run admins seed (comma-separated) | — |
| `APPROVED_CONVERSATION_IDS` | First-run approved GCs seed | — |
| `SENSITIVE_TOPICS` | Extra sensitive phrases to block | — |
| `TICKET_PREFIX` | Ticket ID prefix | `AMR` |
| `NOTIFY_ON_TICKET` | Ticket notification flag | `false` |
| `ENABLE_TICKETS` | Collect/create tickets; when `false`, emergency issues fire admin alerts instead | `false` |
| `MAX_CONCURRENT`, `QUEUE_TIMEOUT`, `SESSION_TIMEOUT`, `RATE_LIMIT_WINDOW`, `MAX_REQUESTS_PER_WINDOW` | Performance tuning | see `.env.example` |
| `CACHE_TTL`, `MAX_CACHE_SIZE` | Response cache | `3600`, `1000` |
| `MAX_IMAGE_SIZE_MB`, `UPLOAD_DIR` | Image attachment handling | `10`, `/ami-uploads` |

With no API key configured, the AI provider is `none` and Ami falls back to keyword-based rules.

## HTTP Endpoints

| Endpoint | Purpose |
|---|---|
| `POST /api/messages` | Bot Framework message endpoint (JWT-validated in production) |
| `GET /api/health` | Health + metrics + departments |
| `GET /api/tickets` | All created tickets |

## Deploying to Microsoft Teams

The repo is Teams Toolkit-ready (`infra/`, `appPackage/`). Recommended path — **Azure App Service (Linux)** + Teams Toolkit:

1. **Prerequisites**: Azure subscription; Teams Toolkit extension (or `@microsoft/teamsfx-cli`); Teams admin permission to sideload apps.
2. **Provision**: `teamsfx provision` — creates the Entra app registration and App Service from `infra/`. This fills `BOT_ID`, `BOT_PASSWORD`, `TEAMS_APP_ID` into `.localConfigs` / env.
3. **Deploy**: `teamsfx deploy` (or push code to the App Service) — `npm run build && node dist/index.js` is the start command.
4. **Configure secrets** on the host: `BOT_ID`, `BOT_PASSWORD`, `GEMINI_API_KEY`, and seed `ALLOWED_USER_IDS` / `ADMIN_USER_IDS` / `SENSITIVE_TOPICS`. Prefer Azure Key Vault for secrets.
5. **Publish**: zip `appPackage/` (manifest + icons) → upload in the Teams admin center (or `teamsfx publish`). Confirm developer URLs in the manifest are yours.
6. **Approve chats**: have an admin send `/approve` in each real group chat; personal chats need allowlisted users (`/allow <id>`).

> Custom engine Copilot/agent usage: the manifest includes a `copilotAgents.customEngineAgents` entry (new Teams Agent model). If you only need a classic bot, remove that block before publishing.

## Flows & Departments

- Flow definitions live in `src/flows/departments/<dept>/flow.json` + `rules.json` (keyword-based department detection)
- Adding a department requires: the `flow.json`, the `rules.json`, and an entry in the `departments` array in `src/config/config.ts`
- Ticket collection always asks 4 fields: `issue_type`, `description`, `urgency`, `department` (hard-coded in `src/core/agent.ts`)
- Flows are loaded from disk at startup (also copied into `dist/flows` at build time) — restart the bot after editing them

## Known Gotchas

- `npm run dev` uses nodemon + ts-node from `src/`; `npm run build` compiles to `dist/` **and copies `src/flows` into `dist/flows`**. Run the compiled app as `node dist/index.js` (after `npm run build`).
- `web.config` is only needed for Windows/iisnode hosting; with Linux App Service use the start command instead (`node dist/index.js`).
- Incoming JWT validation only activates when `BOT_ID` is set (dev emulator skips it). Spoofing the `emulator`/`test` channelId only bypasses gates from loopback.
- No test suite (`npm test` is a stub); `npm run build` (`tsc --build`) is the only verification.
