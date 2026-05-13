# UP POST Implementation Plan

## Phase 1 - Foundation

- [x] Add UP POST docs and schema.
- [x] Add `up_post` prompt template with strict JSON output.
- [x] Add `up_post_variants` migration.
- [x] Add API to list source content from AFF VID or research.
- [x] Add API to generate platform-specific variants.
- [x] Add API to mark variants as `queued`.
- [x] Add UI tab for source selection, platform selection, JSON preview, and enqueue.
- [x] Add service split for source loading, prompt building, generation, validation, persistence, and enqueue handoff.
- [x] Add V2 columns for `raw_json`, `render_data`, top-level post fields, scores, model metadata, and publisher handoff.
- [x] Add statuses `draft`, `validated`, `queued`, `published`, `failed`.
- [x] Add platform registry and validation for Threads, Facebook text, TikTok caption, and Facebook video.

## Phase 2 - Queue Integration

- [ ] Connect `up_post_variants.status = queued` to a real BullMQ/n8n publishing worker.
- [ ] Add publisher result update endpoint: `PATCH /api/research/up-post/variants/:post_id`.
- [ ] Add retry count and last error fields.
- [ ] Decide whether publisher should use BullMQ, n8n webhook polling, or Playwright/API-specific adapters.

## Phase 3 - Scheduling

- [ ] Add UI date/time selector for `scheduled_time`.
- [ ] Add timezone-safe schedule conversion.
- [ ] Add per-platform posting windows.
- [ ] Add conflict checks to avoid duplicate post times.

## Phase 4 - Performance Tracking

- [ ] Add `post_metrics` table keyed by `post_id`.
- [ ] Track impressions, views, comments, shares, saves, clicks, orders.
- [ ] Add platform performance dashboard.
- [ ] Feed metrics back into AFF VID/UP POST scoring.

## Phase 5 - A/B Testing

- [ ] Generate multiple hooks per platform.
- [ ] Add `variant_group_id`.
- [ ] Compare hook/body/CTA performance.
- [ ] Auto-promote best variants for reuse.

## Current V2 Notes

- Generated variants are saved as `validated` when backend validation passes.
- Variants with validation errors remain `draft`.
- `enqueue` accepts `draft`, `validated`, or `failed` variants and changes them to `queued`.
- `raw_json` stores the full Gemini/fallback response for reprocessing.
- `render_data` stores UI-ready preview content.
- `queue_payload` is the stable handoff contract for future publishers.
