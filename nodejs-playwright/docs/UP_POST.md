# UP POST Multi-Platform Publishing Drafts

Last updated: 2026-05-14.

UP POST converts prepared AFF VID or AI Research source content into platform-native social post variants. It does not publish directly yet. It creates validated drafts, stores raw and rendered data, and prepares queue payloads for a future BullMQ, n8n, Playwright, or API publisher.

## Goals

- Use only source content from `aff_video_plans` or `product_trend_results`.
- Generate a distinct post per platform.
- Normalize source data before prompt generation.
- Apply platform-specific generation rules.
- Validate every variant before saving.
- Store raw AI JSON, normalized post JSON, rendered UI data, and publisher handoff payload.
- Support future publisher status transitions.

## Supported Platforms

Canonical platform ids:

| Platform | Post type | Format |
|---|---|---|
| `threads` | `text` | Short, curious/opinion-led, compact, minimal hashtags |
| `facebook` | `text` | Feed-friendly context, readable paragraphs, clear CTA |
| `tiktok_caption` | `caption` | Strong hook, fast rhythm, compact hashtags |
| `facebook_video` | `video_post` | Video description, hook, CTA, optional shot suggestions |

Alias:

- `facebook_text` maps to `facebook`.

## Current Flow

1. UI loads source content with `GET /api/research/up-post/sources`.
2. User selects source, platforms, campaign tag, scheduled time, post type, tone, and CTA type.
3. Backend loads source from `aff_video_plans` or `product_trend_results`.
4. Backend normalizes source into a compact source object.
5. Backend builds a strict JSON prompt with platform rules.
6. Gemini returns platform-separated posts.
7. Backend normalizes each post with platform fallback rules.
8. Backend validates required fields, hashtags, body length, platform fit, and risky claims.
9. Backend stores each variant in `up_post_variants`.
10. UI displays rendered previews grouped by platform.
11. User calls `POST /api/research/up-post/enqueue` to mark selected variants as `queued`.
12. Future publisher service reads `queue_payload` from queued rows.

## Source Loading

AFF VID source:

```http
GET /api/research/up-post/sources?source_type=aff_vid&limit=20
```

Research source:

```http
GET /api/research/up-post/sources?source_type=research&limit=20
```

With date:

```http
GET /api/research/up-post/sources?source_type=aff_vid&date=2026-05-13&limit=20
```

Source response rows include:

```json
{
  "source_content_id": "uuid-or-product-id",
  "source_type": "aff_vid",
  "product_id": "product-id",
  "title": "string",
  "summary": "string",
  "platforms": ["threads", "facebook", "tiktok_caption", "facebook_video"],
  "warnings": [],
  "status": "draft",
  "created_at": "timestamp"
}
```

## Generate Variants

```http
POST /api/research/up-post/generate
Content-Type: application/json

{
  "source_content_id": "aff_video_plan_uuid_or_product_id",
  "source_type": "aff_vid",
  "platforms": ["threads", "facebook", "tiktok_caption", "facebook_video"],
  "scheduled_time": null,
  "campaign_tag": "may-viral-test",
  "post_type": null,
  "tone": "clear, platform-native, safe CTA",
  "cta_type": "engagement_or_click"
}
```

Response:

```json
{
  "success": true,
  "data": {
    "source_content_id": "string",
    "source_type": "aff_vid",
    "schema_version": "UP_POST_V2",
    "generated_at": "2026-05-14T00:00:00.000Z",
    "model_name": "gemini-2.5-flash",
    "warnings": [],
    "posts": [
      {
        "id": "source_threads",
        "post_id": "source_threads",
        "source_content_id": "string",
        "source_type": "aff_vid",
        "platform": "threads",
        "post_type": "text",
        "title": "string",
        "hook": "string",
        "body": "string",
        "CTA": "string",
        "hashtags": ["#tag"],
        "confidence_score": 75,
        "platform_fit_score": 80,
        "scheduled_time": null,
        "campaign_tag": "may-viral-test",
        "schema_version": "UP_POST_V2",
        "model_name": "gemini-2.5-flash",
        "generated_at": "timestamp",
        "status": "validated",
        "validation_warnings": [],
        "validation_errors": [],
        "shot_suggestions": [],
        "raw_json": {},
        "render_data": {
          "platform": "threads",
          "label": "Threads",
          "preview_text": "body plus hashtags",
          "warnings": []
        },
        "queue_payload": {
          "post_id": "source_threads",
          "platform": "threads",
          "post_type": "text",
          "body": "string",
          "publisher_handoff": {
            "target": "future_publisher_or_n8n",
            "status": "ready"
          }
        }
      }
    ]
  }
}
```

## Variant Statuses

Current supported statuses:

| Status | Meaning |
|---|---|
| `draft` | Generated but has validation errors or needs review |
| `validated` | Generated, normalized, and valid enough for handoff |
| `queued` | Selected for future publisher/n8n worker |
| `published` | Reserved for publisher completion |
| `failed` | Reserved for publisher/generation failure tracking |

`POST /api/research/up-post/enqueue` moves `draft`, `validated`, or `failed` variants to `queued`.

## List Variants

```http
GET /api/research/up-post/variants?limit=30
GET /api/research/up-post/variants?status=validated&limit=30
GET /api/research/up-post/variants?status=queued&platform=facebook&limit=30
GET /api/research/up-post/variants?campaign_tag=may-viral-test&limit=30
```

Response rows include both old and new fields:

- `post_data`: full normalized post JSON.
- `raw_json`: original AI response used for reprocessing.
- `render_data`: UI-ready preview object.
- `queue_payload`: publisher/n8n handoff payload.
- Top-level searchable columns: `platform`, `post_type`, `title`, `hook`, `body`, `cta`, `hashtags`, `confidence_score`, `platform_fit_score`, `campaign_tag`, `model_name`, `generated_at`.

## Queue Handoff

```http
POST /api/research/up-post/enqueue
Content-Type: application/json

{
  "post_ids": ["source_threads", "source_facebook"]
}
```

Publisher/n8n can then read:

```http
GET /api/research/up-post/variants?status=queued&limit=30
```

Use `queue_payload` for execution. It contains stable handoff fields and `render_data`.

## Database Schema

Primary table: `up_post_variants`.

Base fields:

- `id UUID`
- `post_id TEXT UNIQUE`
- `source_content_id TEXT`
- `source_type TEXT`
- `platform TEXT`
- `post_data JSONB`
- `status TEXT`
- `queue_payload JSONB`
- `scheduled_time TIMESTAMP`
- `schema_version TEXT`
- `created_at TIMESTAMP`
- `updated_at TIMESTAMP`

V2 fields:

- `raw_json JSONB`
- `render_data JSONB`
- `validation_warnings JSONB`
- `campaign_tag TEXT`
- `post_type TEXT`
- `title TEXT`
- `hook TEXT`
- `body TEXT`
- `cta TEXT`
- `hashtags TEXT[]`
- `confidence_score INTEGER`
- `platform_fit_score INTEGER`
- `model_name TEXT`
- `generated_at TIMESTAMPTZ`
- `published_at TIMESTAMPTZ`
- `failed_reason TEXT`

Status constraint:

```sql
CHECK (status IN ('draft', 'validated', 'queued', 'published', 'failed'))
```

Migration:

```bash
node migrate_up_post.js
```

The runtime service also calls `ensureUpPostTables()`, so missing V2 columns are added automatically when UP POST APIs run.

## Validation Rules

Backend validation runs before persistence:

- Required body cannot be empty.
- Missing title, hook, CTA, or hashtags creates warnings and safe fallbacks.
- Hashtags are normalized to start with `#` and contain no spaces.
- Platform ids are canonicalized; invalid platforms are rejected.
- Duplicate body across platforms is rewritten with backend platform framing and warning.
- Strong or unsupported claims create warnings.
- Source weakness creates warnings and lowers confidence.

Examples of risky claim language that triggers warning:

- `100%`
- `chac chan`
- `cam ket`
- `bao dam`
- `tot nhat`
- `tri khoi`
- `kiem tien nhanh`

## Current Implementation Files

- `src/up-post-service.js`: source loading, prompt building, generation, validation, persistence, enqueue handoff.
- `src/research-routes.js`: HTTP routes wired to the UP POST service.
- `migrate_up_post.js`: V2 table migration.
- `public/research.js`: UI source loading, generation preview, variant listing, enqueue.
- `public/research.html` and `public/index.html`: UP POST controls in the research dashboard.

## Not Yet Implemented

- Real publishing worker.
- PATCH endpoint for publisher result updates.
- Metrics table for impressions/views/clicks/orders.
- Platform posting window optimization.
- Multi-hook A/B generation per platform.
