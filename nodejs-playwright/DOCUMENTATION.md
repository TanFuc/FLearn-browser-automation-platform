# FAuto Current Project Documentation

Last updated: 2026-05-14, Asia/Saigon.

This document reflects the current repository and local database/Redis state after scanning the project. Counts and latest dates are runtime snapshots and will change as jobs run.

## 1. Executive Status

FAuto is a Node.js automation dashboard with three main areas:

- Facebook account automation: invite, unfollow, and warmup tasks driven by Playwright.
- Schedule management: immediate jobs, daily-time jobs, and interval jobs through BullMQ/Redis.
- AI Research: Gemini-backed research pages, product trends, AFF VID, UP POST, prompt management, quota tracking, and daily refresh.

Current code status:

- Backend starts from `src/index.js`, which loads `src/server.js`.
- Express serves `public/` and mounts research routes at both `/api/product-trends` and `/api/research`.
- `src/worker.js` starts two BullMQ workers:
  - `invite-queue` for account automation.
  - `research-queue` for AI research refresh.
- `src/queue.js` registers the AI research daily repeat job with timezone `Asia/Ho_Chi_Minh`.
- AI daily refresh now covers all research pages:
  - Trends V4 for `today`, `last_3_days`, `last_7_days`.
  - MMO legacy page.
  - AI Tools legacy page.
  - Suggestions legacy page.

Current live snapshot from local PostgreSQL/Redis:

| Area | Current state |
|---|---|
| Accounts | 12 rows, all `active` |
| Tasks | 113 rows: 62 completed, 51 failed |
| Logs | 7350 rows |
| Automation schedules | 21 rows: 1 active time schedule, 2 completed, 18 cancelled |
| Invite queue | 0 waiting, 0 active, 22 delayed, 22 repeat jobs |
| Research queue | 0 waiting, 0 active, 1 delayed, 1 repeat job |
| Research repeat job | `manual-research`, cron `0 8 * * *`, timezone `Asia/Ho_Chi_Minh`, next `2026-05-14T01:00:00.000Z` |
| Gemini quota | date `2026-05-13`, 6/20 requests used, 24419/200000 tokens, not blocked |

Current AI data snapshot:

| Page | Latest local date | Rows |
|---|---:|---:|
| MMO | 2026-05-09 | 12 |
| AI Tools | 2026-05-09 | 10 |
| Suggestions | 2026-05-09 | 10 |
| Trends V4 | 2026-05-13 | 161 |
| AFF VID | 2026-05-11 | 2 |
| UP POST | 2026-05-11 | 8 |

Important operational note: the code now refreshes MMO, AI Tools, and Suggestions daily, but the local DB snapshot still shows those legacy pages at 2026-05-09 because the new daily job code has not yet completed a run after this change. Restart the server/worker and run `POST /api/research/admin/run-daily-job`, or wait for the 08:00 Asia/Ho_Chi_Minh schedule.

## 2. Tech Stack

| Layer | Tool |
|---|---|
| Runtime | Node.js, CommonJS |
| Web server | Express 5 |
| Realtime | Socket.io |
| Browser automation | Playwright Chromium persistent contexts |
| Queue | BullMQ |
| Queue broker | Redis through `ioredis` |
| Database | PostgreSQL through `pg` |
| AI provider | Google Gemini REST API |
| Frontend | Static HTML/CSS/vanilla JS |
| Tests | Jest, Supertest |

Package scripts:

```bash
npm run start      # node src/index.js
npm run dev        # same as start
npm run init-db    # create initial accounts/tasks/ai_request_attempts tables
npm test           # run Jest tests
```

## 3. Runtime Configuration

Environment variables used by the code:

| Variable | Purpose | Default in code |
|---|---|---|
| `PORT` | Express port | `3000` |
| `DB_USER` | PostgreSQL user | `postgres` |
| `DB_HOST` | PostgreSQL host | `localhost` |
| `DB_NAME` | PostgreSQL database | `automation` |
| `DB_PASSWORD` | PostgreSQL password | `123456` |
| `DB_PORT` | PostgreSQL port | `5432` |
| `REDIS_HOST` | Redis host | `127.0.0.1` |
| `REDIS_PORT` | Redis port | `6379` |
| `REDIS_PASSWORD` | Optional Redis password | none |
| `MAX_CONCURRENCY` | Invite worker concurrency | `5` |
| `APP_TIMEZONE` / `TZ` | App/research timezone | `Asia/Ho_Chi_Minh` |
| `GEMINI_API_KEY` | Gemini API key | required for AI calls |
| `GEMINI_SOFT_CAP` | Daily soft request cap | `20` |
| `GEMINI_HARD_CAP` | Daily hard request cap | `30` |
| `GEMINI_SOFT_TOKEN_CAP` | Daily soft token cap | `100000` |
| `GEMINI_HARD_TOKEN_CAP` | Daily hard token cap | `200000` |
| `REFRESH_COOLDOWN_SECONDS` | UI/API cooldown behavior | used by research routes |
| `DEV_MODE` | Development flag | read by frontend/admin flows |

Do not commit `.env`. The local `.env` contains live credentials/API configuration.

## 4. Repository Map

```text
nodejs-playwright/
  src/
    index.js              entry point, loads server
    server.js             Express, Socket.io, dashboard APIs, scheduler APIs
    worker.js             BullMQ workers for invite-queue and research-queue
    queue.js              BullMQ queue definitions and repeat job registration
    tasks.js              invite, unfollow, warmup, login/checkpoint logic
    browser.js            Playwright persistent context and stable fingerprint
    research-service.js   Gemini product trends and daily research refresh
    research-routes.js    AI Research APIs, AFF VID, UP POST, prompt manager
    gemini.js             Gemini client, quota, cache, usage logs
    db.js                 PostgreSQL pool
    config.js             settings.json read/write, default automation settings
    state.js              pause/resume/stop state
    utils.js              shared helpers such as randomDelay
    init-db.js            initial DB bootstrap
  public/
    index.html            main dashboard
    app.js                dashboard frontend logic
    style.css             main dashboard styles
    research.html         standalone AI Research dashboard
    research.js           AI Research frontend logic
    research.css          AI Research styles
    toast.js              toast helpers
  docs/
    AI_RESEARCH_DATE_FILTER_CHECKLIST.md
    AFF_VID.md
    AFF_VID_IMPLEMENTATION_PLAN.md
    UP_POST.md
    UP_POST_IMPLEMENTATION_PLAN.md
  tests/
    config.test.js
    queue.test.js
  migrations/seeds are root-level scripts named migrate_*.js, init_logs.js, seed_*.js
```

Other root scripts:

| File | Purpose |
|---|---|
| `check_schema.js` | Inspect DB schema |
| `clear_queue.js` | Queue cleanup helper |
| `scratch.js` | Local scratch script |
| `seed_prompts.js` | Seed/update AI prompt variants |
| `seed_dummy_research.js` | Insert dummy research data for UI testing |

## 5. Backend Architecture

Startup flow:

1. `src/index.js` requires `src/server.js`.
2. `src/server.js` loads `.env`, Express, Socket.io, queues, workers, research router, and Gemini quota emitter.
3. Static files are served from `public/`.
4. Research router is mounted twice:
   - `/api/product-trends`
   - `/api/research`
5. `addResearchJob()` registers the daily research repeat job.
6. `ensureAutomationSchema()` makes sure schedule columns exist.
7. `clearQueueOnStartup()` marks pending/running tasks failed and obliterates the invite queue.
8. `rehydrateActiveSchedules()` adds active schedule jobs back to BullMQ.
9. `triggerStartupResearch()` adds one startup research job per UTC date.
10. Server listens on `PORT`.

Realtime events:

| Event | Direction | Meaning |
|---|---|---|
| `log` | server to client | Account/system log line |
| `stats` | server to client | Queue/account dashboard stats |
| `quota_update` | server to client | Gemini quota polling |
| `quota:update` | server to client | Gemini quota event emitted by `gemini.js` |
| `cron_status` | server to client | AI research daily job status |
| `cooldown_update` | server to client | Research cooldown/status updates |

## 6. Queue and Worker Behavior

### invite-queue

Defined in `src/queue.js`, consumed in `src/worker.js`.

Default job options:

- `attempts: 3`
- exponential backoff, 5000ms
- `removeOnComplete: true`
- `removeOnFail: false`

Worker behavior:

- Inserts missing account id if needed.
- Creates a `tasks` row with `status='running'`.
- Checks schedule status/max runs if `scheduleId` is present.
- Opens a Playwright persistent context for the account profile.
- Routes by `taskType`:
  - `invite` -> `autoInviteTask`
  - `unfollow` -> `autoUnfollowTask`
  - `warmup` -> `warmupTask`
- Updates `tasks`, `accounts`, and `automation_schedules` on success/failure.
- Emits logs and stats through `workerEvents`.
- Closes browser context in `finally`.

### research-queue

Defined in `src/queue.js`, consumed in `src/worker.js`.

Repeat job:

- Name: `manual-research`
- Job id: `daily-manual-research`
- Pattern: `0 8 * * *`
- Timezone: `Asia/Ho_Chi_Minh`
- Attempts: 3
- Backoff: exponential, 10000ms
- `removeOnComplete: true`
- `removeOnFail: false`

Startup cleanup:

- `addResearchJob()` removes stale duplicate daily research jobs.
- A stale research repeat job is one with the same daily pattern but a different name or missing/wrong timezone.

## 7. Automation Workflows

### Account browser profile

`src/browser.js` uses Playwright persistent contexts under `profiles/{accountId}`.

Fingerprint behavior:

- Loads an existing `accounts.fingerprint` if present.
- Otherwise selects deterministic UA and viewport from `ua_pool` and `viewport_pool`.
- Saves the fingerprint back to `accounts.fingerprint`.
- Uses timezone `Asia/Ho_Chi_Minh` and locale `vi-VN`.
- Supports proxy formats:
  - URL style: `http://user:pass@host:port`
  - shorthand `host:port:user:pass`

### Invite task

`autoInviteTask()` in `src/tasks.js`:

- Detects checkpoint/disabled/login states.
- Attempts auto-login if `fb_email` and `fb_password` are present.
- Navigates group URL to `/members` if needed.
- Waits for main content.
- Finds Add Friend buttons using ARIA/text selectors.
- Skips admins/moderators if configured.
- Skips verified profiles if configured.
- Applies `keywordsBlacklist`.
- Tracks `invites_sent_today`.

### Unfollow task

`autoUnfollowTask()` is routed by `taskType='unfollow'`.

- Uses account browser session.
- Tracks `unfollows_today`.
- Supports `maxUnfollow`.

### Warmup task

`warmupTask()` is routed by `taskType='warmup'`.

- Uses the same browser/session/fingerprint system.
- Increments worker stats as configured by task result.

## 8. Settings

`src/config.js` reads and writes `settings.json`.

Default settings:

| Setting | Default |
|---|---:|
| `delayMin` | 1000 |
| `delayMax` | 3000 |
| `scrollPauseMin` | 2000 |
| `scrollPauseMax` | 5000 |
| `maxScrolls` | 20 |
| `maxClicks` | 50 |
| `skipAdmins` | true |
| `skipVerified` | true |
| `keywordsBlacklist` | `[]` |

## 9. AI Research System

The AI Research module has two layers:

- Legacy research pages:
  - MMO (`research_results.page_type='mmo'`)
  - AI Tools (`research_results.page_type='ai_tools'`)
  - Suggestions (`ai_suggestions`)
- Product Intelligence V4:
  - Product trend results (`product_trend_results`)
  - Product details (`product_trend_details`)
  - cached product trend responses (`cached_product_trends`)

Gemini client behavior:

- `src/gemini.js` uses REST endpoint `https://generativelanguage.googleapis.com/v1beta/models`.
- Default model: `gemini-2.5-flash`.
- Lite model: `gemini-2.5-flash-lite`.
- Uses `cached_research` unless `skipCache` is true.
- Reserves quota before calling Gemini.
- Rolls back quota reservation on call failure.
- Logs usage into `api_usage_logs`.
- Updates `quota_state`.
- Emits `quota:update`.

Product trend behavior:

- `getProductTrends()` generates V4 product trend data.
- Supported windows:
  - `today`
  - `last_3_days`
  - `last_7_days`
- Product ids are suffixed by window, for example `product__today`.
- On Gemini error, it falls back to latest DB rows and returns stale data.

Daily research refresh:

- Function: `runDailyTrendResearch()` in `src/research-service.js`.
- Triggered by `research-queue`.
- Manual trigger: `POST /api/research/admin/run-daily-job`.
- Scope:
  - Trends V4: `today`, `last_3_days`, `last_7_days`.
  - Legacy pages: `mmo`, `ai_tools`, `suggestions`.
- Each section catches and records errors independently, so one failed page does not stop the rest.

Date behavior:

- Frontend omits `date` when user wants latest available.
- Backend resolves latest available per page.
- If a date is supplied, backend reads only that local date.
- Date availability endpoint: `GET /api/research/date-availability`.

Known timestamp caveat:

- `research_results`, `ai_suggestions`, `api_usage_logs`, and `quota_state` use `timestamptz`.
- `product_trend_results`, `aff_video_plans`, and `up_post_variants` use `timestamp without time zone`.
- Date filters use local date helpers. Be careful when comparing raw timestamps across these tables.

## 10. AFF VID

AFF VID turns Product Trends rows into affiliate video plans.

Core tables:

- Source: `product_trend_results`
- Output: `aff_video_plans`

Core APIs:

- `GET /api/research/aff-vid/source-products`
- `GET /api/research/aff-vid/plans`
- `POST /api/research/aff-vid/generate`

Behavior:

- Does not invent products outside `product_trend_results`.
- Accepts product id and platform targets.
- Calls Gemini with prompt type `aff_vid`.
- Normalizes/falls back from source product data when Gemini output is partial.
- Stores plans with `status='draft'` by default.

Implementation status:

- Read/generate APIs exist.
- Status update endpoint is still documented as future work in `docs/AFF_VID_IMPLEMENTATION_PLAN.md`.

## 11. UP POST

UP POST turns AFF VID plans or Product Trends content into platform-specific post variants.

Core tables:

- Source: `aff_video_plans` or `product_trend_results`
- Output: `up_post_variants`

Core APIs:

- `GET /api/research/up-post/sources`
- `GET /api/research/up-post/variants`
- `POST /api/research/up-post/generate`
- `POST /api/research/up-post/enqueue`

Behavior:

- Supports source type `aff_vid` or `research`.
- Supports platforms, scheduled time, campaign tag, post type, tone, and CTA type.
- Normalizes source content before prompt generation.
- Generates one materially distinct variant per platform.
- Validates every variant before saving.
- Stores generated variants as `validated` when valid, or `draft` when validation errors remain.
- Stores `raw_json`, `post_data`, `render_data`, and `queue_payload` for reprocessing, UI preview, and future publisher handoff.
- Supports statuses `draft`, `validated`, `queued`, `published`, and `failed`.

Implementation status:

- Read/generate/enqueue APIs exist.
- Core logic now lives in `src/up-post-service.js`.
- Current schema version is `UP_POST_V2`.
- Publisher result update endpoint is still documented as future work in `docs/UP_POST_IMPLEMENTATION_PLAN.md`.

## 12. API Endpoints

### Core config and logs

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/config` | Read `settings.json` merged with defaults |
| POST | `/api/config` | Save settings |
| GET | `/api/logs` | Read recent logs |
| POST | `/api/admin/reset-cooldown` | Reset research cooldown state if available |

### Account management

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/accounts` | List non-deleted accounts |
| GET | `/api/accounts/deleted` | List soft-deleted accounts |
| POST | `/api/accounts` | Create/upsert account |
| PUT | `/api/accounts/:id` | Update account |
| DELETE | `/api/accounts/:id` | Soft delete account |
| POST | `/api/accounts/:id/restore` | Restore soft-deleted account |
| DELETE | `/api/accounts/:id/hard` | Archive to `deleted_accounts` and hard delete |
| POST | `/api/accounts/:id/browser` | Open manual browser session |

### Task control

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/run` | Enqueue immediate or scheduled invite/unfollow/warmup job |
| POST | `/api/pause` | Pause bot state and invite queue |
| POST | `/api/resume` | Resume bot state and invite queue |
| POST | `/api/stop` | Stop bot state and obliterate invite queue |

### Automation schedules

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/automation/schedules` | List schedules with filters |
| GET | `/api/automation/summary` | Schedule/task summary |
| GET | `/api/automation/history` | Task history by schedule/account/date/type/status |
| DELETE | `/api/automation/schedules/:id` | Mark schedule cancelled |

### Research routes

These are mounted under both `/api/research` and `/api/product-trends`.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/` | Product trends list |
| GET | `/page-1` | MMO legacy page |
| GET | `/page-2` | AI Tools legacy page |
| GET | `/page-3` | Suggestions legacy page |
| GET | `/usage` | Quota and recent API usage |
| GET | `/usage/daily` | Daily usage aggregation |
| GET | `/date-availability` | Available dates and counts per page |
| GET | `/cooldown` | Research cooldown/quota block status |
| GET | `/overview` | AI Research overview counts |
| GET | `/prompts` | List research prompts |
| POST | `/prompts` | Create/update prompt |
| POST | `/prompts/:id/activate` | Activate prompt variant |
| DELETE | `/prompts/:id` | Delete prompt |
| POST | `/test-gemini` | Test Gemini request |
| GET | `/aff-vid/source-products` | List source products for AFF VID |
| GET | `/aff-vid/plans` | List AFF VID plans |
| POST | `/aff-vid/generate` | Generate AFF VID plan |
| GET | `/up-post/sources` | List UP POST sources |
| GET | `/up-post/variants` | List UP POST variants |
| POST | `/up-post/generate` | Generate UP POST variants |
| POST | `/up-post/enqueue` | Enqueue/update UP POST variant status |
| GET | `/:id` | Product trend detail with deep dive/opportunity |
| POST | `/refresh` | Manual refresh for Trends or legacy pages |
| POST | `/admin/run-daily-job` | Queue daily research job |
| POST | `/admin/reset-quota` | Reset Gemini quota |

## 13. Frontend Surfaces

### Main dashboard

Files:

- `public/index.html`
- `public/app.js`
- `public/style.css`
- `public/research.css`
- `public/research.js`

Tabs:

- Dashboard
- Accounts
- Settings
- Logs
- Schedules
- AI Research

### Standalone AI Research dashboard

Files:

- `public/research.html`
- `public/research.js`
- `public/research.css`

Pages:

- MMO / Affiliate Intelligence
- AI Tools Market
- AI Suggestions
- Product Trends
- AFF VID
- UP POST
- Quota Monitor
- Prompt Manager

## 14. Database Tables

Current public tables:

```text
accounts
aff_video_plans
ai_request_attempts
ai_suggestions
api_usage_logs
automation_job_history
automation_schedules
cached_product_trends
cached_research
deleted_accounts
logs
product_trend_details
product_trend_results
quota_state
research_prompts
research_results
research_topics
tasks
ua_pool
up_post_variants
viewport_pool
```

Core automation tables:

| Table | Purpose | Key columns |
|---|---|---|
| `accounts` | Facebook account records | `id`, `status`, `proxy`, `fb_email`, `fb_password`, `daily_limit`, `invites_sent_today`, `unfollows_today`, `fingerprint`, `deleted_at` |
| `tasks` | Job execution history | `account_id`, `type`, `payload`, `status`, `started_at`, `finished_at`, `schedule_id`, `result_summary`, `error` |
| `logs` | Persistent UI/system logs | `account_id`, `type`, `message`, `created_at`, `automation_job_id` |
| `automation_schedules` | User-created schedules | `account_ids`, `task_type`, `schedule_type`, `schedule_value`, `status`, `max_runs`, `run_count`, `success_count`, `failed_count` |
| `automation_job_history` | Older/auxiliary schedule history table | `schedule_id`, `account_id`, `task_type`, `status`, `result_summary`, `error_message` |
| `deleted_accounts` | Archive before hard delete | copied account fields plus delete timestamps |
| `ua_pool` | User-agent pool | `user_agent`, `platform`, `is_active` |
| `viewport_pool` | Viewport pool | `width`, `height`, `is_active` |

AI/research tables:

| Table | Purpose | Key columns |
|---|---|---|
| `research_topics` | Active topics for prompt variables | `name`, `category`, `is_active` |
| `research_prompts` | Prompt variants and active prompt per page | `page_type`, `variant_name`, `prompt_text`, `is_active` |
| `research_results` | Legacy MMO/AI Tools rows | `page_type`, `title`, `category`, `data`, scores, `created_at` |
| `ai_suggestions` | Suggestions page rows | `recommendation_title`, `recommendation_text`, scores, `raw_data` |
| `product_trend_results` | V4 trend products | `product_id`, `market`, `category`, `raw_data`, `source_window`, `schema_version` |
| `product_trend_details` | Deep dive/opportunity per product | `product_id`, `type`, `detail_data` |
| `cached_product_trends` | V4 product trend cache | hash columns, `data`, `expires_at` |
| `cached_research` | Gemini prompt cache | `cache_key`, `payload_json`, `expires_at` |
| `api_usage_logs` | Gemini usage log | `model`, token counts, `cache_hit`, `endpoint`, `created_at` |
| `quota_state` | Daily Gemini quota state | `request_count`, token counts, caps, block fields, cron timestamps |
| `aff_video_plans` | AFF VID generated plans | `product_id`, `plan_data`, `status`, `platform_targets`, `source_window` |
| `up_post_variants` | UP POST generated variants | `post_id`, `source_content_id`, `source_type`, `platform`, `post_data`, `status`, `scheduled_time` |
| `ai_request_attempts` | Initial AI attempt table | `endpoint`, `prompt_hash`, `model_name`, `success`, `error_message` |

## 15. Migrations and Seed Order

Recommended setup for a fresh database:

```bash
npm run init-db
node migrate_delete_cols.js
node migrate_fingerprint.js
node init_logs.js
node migrate_research.js
node migrate_gemini_cache_fix.js
node migrate_gemini_fix.js
node migrate_research_v3.js
node migrate_research_v4.js
node migrate_prompts.js
node seed_prompts.js
node migrate_aff_vid.js
node migrate_up_post.js
node migrate_schedules.js
```

Notes:

- `migrate_research_v2.js` recreates `cached_research` with an older schema. Prefer the newer `migrate_gemini_cache_fix.js` + `migrate_gemini_fix.js` path for the current `gemini.js`.
- `seed_dummy_research.js` is for demo/test data, not normal production refresh.
- `check_schema.js` is an inspection helper.

## 16. Tests and Verification

Current tests:

- `tests/config.test.js`
- `tests/queue.test.js`

Last verification run:

```bash
npm test -- --runInBand
```

Result: 2 test suites passed, 5 tests passed.

Syntax checks run:

```bash
node -c src/research-service.js
node -c src/queue.js
```

Result: OK.

## 17. Operations

Start dependencies:

- PostgreSQL must be running.
- Redis must be running and match `.env` password/host/port.
- Gemini calls require a valid `GEMINI_API_KEY`.

Start app:

```bash
cd nodejs-playwright
npm install
npx playwright install chromium
npm run start
```

Open dashboard:

```text
http://localhost:<PORT>
```

Useful checks:

```bash
npm test -- --runInBand
node check_schema.js
```

Useful HTTP checks:

```http
GET /api/accounts
GET /api/automation/schedules
GET /api/research/date-availability
GET /api/research/usage
GET /api/research/overview
POST /api/research/admin/run-daily-job
```

After code changes to workers or queues:

- Restart the Node process.
- Confirm Redis repeat jobs with `researchQueue.getRepeatableJobs()`.
- Confirm `GET /api/research/date-availability` after the research job finishes.

## 18. Known Gaps and Risks

Current technical gaps:

- Some source files and old documentation contain mojibake text from prior encoding issues. This new `DOCUMENTATION.md` is clean UTF-8/ASCII-oriented, but source comments/UI strings may still display incorrectly in some terminals.
- The local `.env` contains sensitive values. Keep it out of git.
- `product_trend_results`, `aff_video_plans`, and `up_post_variants` use `timestamp without time zone`; other research/quota tables use `timestamptz`.
- `automation_job_history` exists but current worker mainly writes to `tasks` and `automation_schedules`.
- `clearQueueOnStartup()` obliterates the invite queue and marks pending/active/running tasks as failed on every server restart. This is intentional cleanup, but it means restarts cancel in-flight invite jobs.
- Invite queue currently has many delayed/repeat jobs from schedules; review active/cancelled schedules if queue noise grows.
- AFF VID and UP POST still have planned status/update endpoints in implementation docs.
- Research daily refresh now covers all pages, but DB freshness depends on the new code being loaded and the job completing under quota.

Operational risk notes:

- If Gemini quota is exhausted, daily refresh may partially complete and record per-page errors.
- If Redis is unavailable, BullMQ workers and schedules cannot run.
- If PostgreSQL is unavailable, both automation and AI modules fail.
- If a browser profile is already locked, `browser.js` tries to remove `SingletonLock`; manual intervention may still be needed for stuck Chromium processes.

## 19. Related Documentation

- `docs/AI_RESEARCH_DATE_FILTER_CHECKLIST.md`: date filtering and daily refresh smoke tests.
- `docs/AFF_VID.md`: AFF VID behavior and API examples.
- `docs/AFF_VID_IMPLEMENTATION_PLAN.md`: AFF VID implementation checklist.
- `docs/UP_POST.md`: UP POST behavior and API examples.
- `docs/UP_POST_IMPLEMENTATION_PLAN.md`: UP POST implementation checklist.
- `AGENTS.md`: development and governance rules, partially stale in model names and some implementation details.

## 20. Recent Changes Captured Here

- Daily AI research job now refreshes Trends V4 plus MMO, AI Tools, and Suggestions.
- Daily research repeat job now uses `Asia/Ho_Chi_Minh` timezone.
- Stale duplicate research repeat jobs are cleaned up at registration time.
- Queue tests were updated to expect timezone-aware repeat configuration.
- This documentation now records current DB/Redis state and the actual current module/API layout.
