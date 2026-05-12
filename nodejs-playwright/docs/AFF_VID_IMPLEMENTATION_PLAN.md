# AFF VID Implementation Plan

## Phase 1 - Foundation

- [x] Add AFF VID docs and schema contract.
- [x] Add `aff_vid` prompt template with strict JSON output.
- [x] Add `aff_video_plans` migration.
- [x] Add API to list source products from research DB.
- [x] Add API to generate and persist video plan.
- [x] Add dashboard UI for candidate selection and JSON preview.

## Phase 2 - n8n Integration

- [ ] Add `PATCH /api/research/aff-vid/plans/:id/status`.
- [ ] Add `GET /api/research/aff-vid/plans?status=draft`.
- [ ] Define n8n workflow input mapping:
  - `script` -> TTS
  - `shot_list` -> visual/render blocks
  - `caption` + `hashtags` -> post metadata
  - `platform_targets` -> publishing branch
- [ ] Add retry and failure state: `draft`, `rendering`, `rendered`, `posting`, `posted`, `failed`.

## Phase 3 - Auto Publishing

- [ ] Add per-platform caption length and hashtag rules.
- [ ] Add media asset fields: `asset_query`, `product_image_url`, `voice_style`, `music_mood`.
- [ ] Add schedule support for AFF VID posting.
- [ ] Add performance tracking: views, CTR, comments, saves, affiliate clicks.

## Phase 4 - Optimization

- [ ] Rank candidates by historical conversion performance.
- [ ] Generate 3 hook variants per product.
- [ ] A/B test CTA and caption.
- [ ] Add guardrail for regulated products and risky claims.
