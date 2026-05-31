# FAuto System Architecture & AI Governance

## 🚀 Project Overview
FAuto is a professional Facebook automation platform designed for invitation management, account warming, and AI-driven market research. It operates as a multi-account system with a headless browser engine and a centralized job management server.

## 🛠 Tech Stack
- **Runtime**: Node.js (CommonJS)
- **Automation**: CloakBrowser (Playwright-compatible stealth configuration)
- **Web Server**: Express.js
- **Database**: PostgreSQL (pg)
- **Caching & Queue**: Redis + BullMQ
- **Intelligence**: Google Gemini API (Flash 2.0)
- **UI**: Vanilla HTML/JS/CSS (Dashboard)

---

## 📜 Global Development Rules
- **Naming**: `camelCase` for JS/Node, `snake_case` for PostgreSQL/DB.
- **Modularity**: Keep tasks in `src/tasks.js`, database logic in `src/db.js`, and AI logic in `src/gemini.js`.
- **Consistency**: Follow existing patterns for `emitLog` and `getBotState`.
- **Documentation**: Maintain JSDoc comments for all exported functions.

## 🛡 Anti-Detection First Rules
- **Human-like Delay**: Use `randomDelay(min, max)` from `src/utils.js` for every interaction. Never use static `waitForTimeout`.
- **Interaction**: Prefer `evaluate(node => node.click())` for reliability. Use `scrollIntoView` before interaction.
- **Randomization**: Randomize scroll amounts, pause durations, and task orders.
- **Session Safety**: Always check `autoLogin` status before starting heavy tasks.

## ⚠️ Error Handling Rules
- **Zero Crash Policy**: Wrap all async operations in `try-catch`.
- **Graceful Degradation**: If an external service (Gemini/Redis) is down, fallback to DB or cache.
- **Atomic Cleanup**: Ensure `browserContext` and `page` are closed in `finally` blocks.
- **Retry Logic**: Implement exponential backoff for network-related failures.

## 📊 Database & Queue Rules
- **Pool Management**: Use `pool` from `src/db.js`. Do not create new connections.
- **Sanitization**: Always use parameterized queries (`$1, $2`). No string interpolation in SQL.
- **Queue Priority**: Respect BullMQ priority levels. Log job completion/failure in `automation_job_history`.
- **Atomicity**: Use DB transactions for multi-step updates (e.g., updating quota and usage logs).

## 🤖 Gemini API Rules
- **Model Selection**: Use `gemini-2.0-flash` for speed and `gemini-1.5-flash` for fallback.
- **Quota Guard**: Respect `hard_cap` and `hard_token_cap`. Check `quota_state` before every call.
- **Strict JSON**: Prompts must enforce JSON output. Use `parseGeminiResponse` to handle extra junk text.
- **Fallback**: Return `{ is_stale: true, data: [...] }` from DB if AI fails.

## 🎭 CloakBrowser Automation Rules
- **Context Isolation**: Use one `BrowserContext` per account to maintain cookies/sessions.
- **Selector Stability**: Use ARIA labels or robust text-based selectors. Avoid fragile CSS classes.
- **State Check**: Verify element visibility before interaction.
- **Cleanup**: Always close `page` objects when a task is finished or failed.

## 📝 Logging Rules
- **Contextual Logging**: Use `emitLog(accountId, message, type)` for UI feedback.
- **Server Logs**: Use `console.log/error` with prefixes like `[Worker]`, `[Server]`, `[AI]`.
- **Verbosity**: Avoid logging sensitive data (cookies, passwords).

## 🧪 Testing & Verification Rules
- **Isolation**: Use `scratch/` folder for one-off test scripts (e.g., `test-gemini.js`).
- **Dry Run**: Validate logic with `DEV_MODE=true` before production deployment.
- **Build Check**: Run `npm run start` to ensure environment injection and port binding are correct.

## 🔄 Git Workflow Rules
- **Atomic Commits**: One feature/fix per commit.
- **Naming**: Follow Conventional Commits (`feat:`, `fix:`, `refactor:`, `chore:`).
- **Branching**: Use `main` for stable and `feat/` for development.

## 🚫 Forbidden Practices
- **No Hardcoding**: Never put API keys, passwords, or tokens in source code. Use `.env`.
- **No Magic Numbers**: Define constants for delays, limits, and timeouts.
- **No Global Overrides**: Avoid modifying global prototypes or browser defaults.
- **No Blind Rescues**: Do not catch errors without logging them.

## Monitoring & Detailed Logs
- **Monitoring-first detail**: Every meaningful operation, including small state changes, refresh requests, queue handoffs, AI calls, DB clears/inserts, fallbacks, retries, and failures, must write a concrete log with enough metadata to trace what happened.
- **Backend system events**: Prefer `emitSystemLog(message, type, meta)` for backend monitoring events so console output, the `logs` table, and the live UI monitor stay in sync.
- **No silent branches**: Any `catch`, fallback, skipped action, empty result, quota block, or validation drop must log the reason and the affected module/page/date before returning.
- **Sensitive data rule**: Do not log cookies, passwords, API keys, raw prompts with secrets, or full auth/session payloads.
