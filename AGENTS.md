# AGENTS.md

Teams help desk bot ("Ami") — TypeScript/Express app that hand-implements the Bot Framework /v3 protocol. No test suite and no linter; `tsc --build` is the only verification.

## Commands

- `npm run dev` — run from source via nodemon + ts-node (`src/index.ts`); listens on port 3978.
- `npm run dev:teamsfx` / `dev:teamsfx:playground` — same, but load bot/Teams config from `.localConfigs` / `.localConfigs.playground` via env-cmd.
- `npm run build` — `tsc --build`, emits to `dist/`.
- `npm test` — stub that always exits 1; do not rely on it.

## Gotchas

- Build emits to `dist/`, but `package.json` `main`/`start` and `web.config` reference `lib/src/index.js` (never produced). Run the compiled app as `node dist/index.js`, not `npm start`.
- Flows are read from disk at runtime, not bundled: `src/services/flow.service.ts` loads `src/flows/**` via `fs` relative to `__dirname`, and the build does not copy `src/flows` into `dist/`. Restart the process after editing a flow.
- Adding a department requires all three: `src/flows/departments/<dept>/flow.json`, `rules.json`, and an entry in the `departments` array in `src/config/config.ts`.
- Ticket collection requires exactly 4 fields, hard-coded in `src/core/agent.ts` (`issue_type`, `description`, `urgency`, `department`), regardless of the flow schema.

## Env / config

- `src/config/config.ts` loads, in order: `.env.dev`, `env/.env.dev`, `env/.env.dev.user`, `.env`. Secrets use a `SECRET_` prefix and live in git-ignored `env/.env.dev.user`; config falls back to `GEMINI_API_KEY || SECRET_GEMINI_API_KEY`, etc.
- Bot credentials (`BOT_ID`, `BOT_PASSWORD`, `BOT_ENDPOINT`) come from `.localConfigs` via the `dev:teamsfx` scripts, not from `config.ts`.
- `AI_PROVIDER` = auto|gemini|openai|azure; `auto` picks the first key present (Gemini → OpenAI → Azure). With no key the provider is `none` and the bot falls back to keyword rules.
- Reply control: `ALLOWED_USER_IDS`, `ADMIN_USER_IDS`, `APPROVED_CONVERSATION_IDS` are first-run seeds only — after that `src/services/access.service.ts` persists everything to git-ignored `access-control.json` (default-deny; admins always allowed). Manage at runtime via admin commands: `/allow <id>`, `/disallow <id>`, `/allowlist`, `/addadmin <id>`, `/removeadmin <id>`, `/admins`, `/approve`, `/restart` (soft restart: clears sessions, reloads flows + access lists).
- Confidentiality: `SENSITIVE_TOPICS` (comma-separated phrases) is merged with built-in defaults in `config.ts`; matches are refused in `agent.ts` before any AI call.

## Bot runtime (`src/app.ts`)

- `POST /api/messages` is the Bot Framework endpoint. It acks 200 immediately and replies asynchronously, POSTing to `serviceUrl/v3/conversations/{id}/activities` via axios with no auth token — emulator only, not real Teams.
- In Teams it responds only when @-mentioned; `channelId === 'emulator'|'test'` responds to everything.
- Group chat approval gate: being added to an unapproved GC posts a "not approved" notice once, then all messages are ignored until an admin (`ADMIN_USER_IDS`) sends `/approve` (or `approve this chat`) in that GC.
- Personal chat (1:1) gate: non-allowed users get a one-time "group chats only" notice then silence; allowed users (allowlist) and admins can chat 1:1 normally (no @mention needed in real Teams 1:1).
- Other endpoints: `GET /api/health`, `GET /api/tickets`.
