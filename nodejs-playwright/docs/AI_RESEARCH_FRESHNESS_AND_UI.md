# AI Research Freshness, Prompt, and UI Specification

Date: 2026-05-26

This document describes the AI Research refresh upgrade for Product Trends, MMO Opportunities, AI Tools, and AI Suggestions. It is the operational reference for keeping research output fresh, evidence-based, dense enough to review quickly, and consistent with the UI.

## Goals

- Produce 10-15 useful results per list-style page.
- Prefer 15 results when evidence is strong enough.
- Allow repeated results only when they are still hot now and have fresh evidence.
- Avoid stale evergreen items such as old generic AI tools, old product examples, or broad business ideas without current signals.
- Force each item to carry source evidence: URL, source date, evidence summary, source window, and confidence.
- Make Suggestions depend only on same-day MMO and AI Tools data during refresh, not all historical database rows.
- Make the UI more compact: fewer tall cards, tighter tables, shorter summaries, and source/evidence chips.

## Freshness Contract

Every research prompt must treat `{{CURRENT_DATE}}` as the hard freshness anchor.

Accepted source windows:

- `today`: same-day signals only.
- `last_3_days`: signals from the last 72 hours.
- `last_7_days`: signals from the current week, maximum 7 days old.

An old item can appear again only when the prompt can show a fresh trigger inside the selected source window:

- New launch.
- Major update.
- New model/integration support.
- Current discount or lifetime deal.
- Marketplace rank movement.
- Viral creator/demo content.
- Fresh community discussion.
- New review cluster.
- Search acceleration.
- GitHub/Product Hunt/Hacker News momentum.

If the source is missing, generic, stale, or unverifiable, `confidence_score` must be below 70 so backend validation can reject it.

## Source Classes

The prompts explicitly ask Gemini/Search to use multiple source classes when available:

- TikTok and TikTok Shop.
- Shopee, Lazada, Amazon, and marketplace reviews.
- Google Trends/search intent.
- YouTube Shorts and creator demos.
- Reddit.
- X/Twitter.
- Facebook Groups.
- Product Hunt.
- Hacker News.
- GitHub Trending daily, exactly `https://github.com/trending?since=daily&spoken_language_code=` when relevant.
- Official changelogs, launch pages, blogs, and pricing pages.
- Newsletters and niche communities.

## Result Count Rules

The canonical count rule is:

- Minimum: 10.
- Maximum: 15.
- Default: 15.
- AI Market override: target 18-25 results, with a hard cap of 30 when evidence is available.
- Return fewer than 10 only if fewer than 10 items are genuinely verifiable.
- Never pad with weak filler.

Code constants:

- `src/research-service.js`: `MIN_RESEARCH_RESULTS = 10`, `MAX_RESEARCH_RESULTS = 15`, `DEFAULT_RESEARCH_RESULTS = 15`; AI Market also uses `AI_MARKET_MIN_RESULTS = 18`, `DEFAULT_AI_MARKET_RESULTS = 25`, `AI_MARKET_MAX_RESULTS = 30`.
- `src/research-routes.js`: same constants for route-level clamping.
- `public/research.js`: Trend V4 default state `limit = 15`.
- `public/index.html` and `public/research.html`: `Limit: 15` selected.

## Prompt Source of Truth

Prompt seed source:

- `seed_prompts.js`

Runtime active prompts:

- Stored in database table `research_prompts`.
- Seed command: `node seed_prompts.js`.
- The seed deactivates old variants per `page_type` and activates the new variant.

Important: editing `seed_prompts.js` alone does not update the DB. Run the seed command after prompt changes.

## Prompt Quality Upgrade V2

Active seeded variants after this upgrade:

- `overview`: `fresh_popular_10_15_v2`
- `mmo`: `fresh_popular_10_15_v2`
- `ai_tools`: `fresh_popular_10_15_v2`
- `suggestions`: `fresh_popular_10_15_v2`
- `deep_dive`: `fresh_context_v2`
- `opportunity`: `fresh_context_v2`
- `aff_vid`: `fresh_source_v2`
- `up_post`: `fresh_source_v2`

The V2 prompt set is stricter than the previous freshness prompts:

- Target 15 useful results by default; allow 10-14 only when quality or evidence would drop.
- Optimize for currently popular, actively discussed, fast-rising, newly launched, newly updated, newly discounted, or newly monetizable items.
- Every item must explain "why now" through `evidence_summary`, `market_signal`, `freshness_note`, `popularity_signal`, or `recent_trigger`.
- Generic legacy examples are rejected unless the item has a dated fresh trigger inside the requested `source_window`.
- No fabricated popularity, ranking, sales, star counts, discounts, release dates, or source URLs.
- Vietnam/commerce pages prioritize Vietnam-relevant signals first, then regional/global signals only when useful for Vietnamese execution.

Server-side enforcement was also tightened:

- Product Trends now require `confidence_score >= 70`.
- Product Trends require `source_dates` to contain a date inside the selected source window for every accepted item.
- MMO and AI Tools already require fresh evidence fields; Suggestions now require supporting source URLs, `source_dates` inside the selected window, `source_window`, and a freshness or reasoning note.
- Plain homepages, documentation landing pages, marketplace search URLs, TikTok/Instagram search pages, and generic listicle sources are treated as weak evidence.
- Existing DB rows are filtered again at read time, so stale or low-evidence rows already in the database are not surfaced as valid latest results.
- If fewer than 10 rows pass validation, the page is treated as having no acceptable current dataset instead of showing a small stale list.
- During refresh, if the first AI response has fewer than 10 valid rows, the backend performs expansion retries that request additional distinct items, merge/dedupe them, and only write the dataset once at least 10 rows pass validation.

## Shared Prompt Blocks

### `CRITICAL_OUTPUT_RULES`

Purpose:

- Prevent malformed Gemini output.
- Enforce valid RFC8259 JSON only.
- Disallow markdown, code fences, explanation text, prefixes, or suffixes.

Applied to:

- Product Trends overview.
- MMO.
- AI Tools.
- Suggestions.
- Deep Dive.
- Opportunity Plan.
- AFF VID.
- UP POST.

### `RESEARCH_VOLUME_RULES`

Purpose:

- Enforce 10-15 result count.
- Prefer 15 when possible.
- Permit repeated results if still currently hot.
- Prevent low-signal filler.

Applied to:

- Product Trends overview.
- MMO.
- AI Tools.
- Suggestions.

### `FRESH_SOURCE_RULES`

Purpose:

- Enforce fresh source evidence.
- Require multiple source classes.
- Require GitHub Trending for developer/open-source tools when relevant.
- Require `source_url`, `source_date`, `evidence_summary`, `source_window` for product/tool/opportunity items.
- Require `supporting_sources`, `source_dates`, `source_window`, and `freshness_note` for Suggestions.

Applied to:

- Product Trends overview.
- MMO.
- AI Tools.
- Suggestions.

## Prompt Details by Page

### Product Trend Overview

Page type: `overview`

Active seeded variant: `fresh_10_15_v1`

Mission:

- Find, rank, and summarize trending consumer products for commerce and content planning.

Key placeholders:

- `{{MARKET}}`
- `{{CATEGORIES}}`
- `{{SOURCE_WINDOW}}`
- `{{WINDOW_DESCRIPTION}}`
- `{{CURRENT_DATE}}`
- `{{LIMIT}}`

Required output shape:

- JSON array.
- 10-15 product objects.

Required fields:

- `id`
- `category`
- `sub_category`
- `product_name`
- `trend_score`
- `growth_signal`
- `competition_level`
- `market_maturity`
- `price_band`
- `target_audience`
- `platform_signal`
- `source_providers`
- `source_urls`
- `source_dates`
- `evidence_summary`
- `search_intent`
- `confidence_score`
- `summary`
- `generated_at`
- `source_window`

Backend validation:

- Product results are normalized in `normalizeProductTrendItem`.
- Results must include product identity, category, trend/confidence score, and summary.
- Results must include source dates.
- `today` requires source dates inside today.
- `last_3_days` and `last_7_days` require dated evidence.
- Server injects `generated_at` and `schema_version`.

Storage:

- Main table: `product_trend_results`.
- Cache table: `cached_product_trends`.

### MMO Opportunity Research

Page type: `mmo`

Active seeded variant: `fresh_10_15_v1`

Mission:

- Find practical MMO, affiliate, and content-commerce opportunities that can be executed this week.

Key placeholders:

- `{{TOPICS}}`
- `{{SOURCE_WINDOW}}`
- `{{CURRENT_DATE}}`
- `{{LIMIT}}`

Required output shape:

- JSON array.
- 10-15 opportunity objects.

Required fields:

- `title`
- `category`
- `trend_score`
- `monetization_score`
- `competition_score`
- `content_angle`
- `traffic_source`
- `monetization_model`
- `market_maturity`
- `confidence_score`
- `summary`
- `source_url`
- `source_date`
- `evidence_summary`
- `source_window`

Backend validation:

- Required fields are checked by `validateLegacyItems`.
- MMO items must pass `hasFreshEvidenceFields`.
- `source_date` must be inside the requested window.
- `confidence_score` must be at least 70.

Storage:

- Table: `research_results`
- `page_type = 'mmo'`

### AI Tools Market Research

Page type: `ai_tools`

Active runtime behavior:

- The service uses a strict server-side AI Tools retry prompt via `buildAiToolsRetryPrompt`.
- Seeded variant `fresh_10_15_v1` remains available in Prompt Library, but runtime prefers the strict generated prompt for reliability.

Mission:

- Find AI tools, AI projects, and AI platforms outstanding in the current week.

Required sources:

- GitHub Trending for developer/open-source tools.
- Official launch/changelog pages.
- Product Hunt.
- Hacker News.
- Reddit.
- X/Twitter.
- Creator demos.
- Newsletters.
- Pricing/discount pages.
- Credible news.

Required output shape:

- JSON array.
- 10-15 AI tool objects.

Required fields:

- `tool_name`
- `tool_type`
- `use_case`
- `value_score`
- `market_signal`
- `market_reason`
- `price_level`
- `discount_or_launch_status`
- `confidence_score`
- `summary`
- `best_value_reason`
- `source_url`
- `source_date`
- `github_trending_url`
- `evidence_summary`
- `is_best_value`
- `is_new_noteworthy`

Backend validation:

- Items must have tool identity, tool type, use case, and fresh evidence.
- `source_date` must be inside the requested window.
- `confidence_score` must be at least 70.
- If validation returns zero items, the service retries with a strict fallback prompt.

Storage:

- Table: `research_results`
- `page_type = 'ai_tools'`

### AI Suggestions

Page type: `suggestions`

Active seeded variant: `fresh_10_15_v1`

Mission:

- Create practical suggestions only from same-day MMO and AI Tools results.

Key placeholders:

- `{{TOPICS}}`
- `{{SOURCE_WINDOW}}`
- `{{CURRENT_DATE}}`
- `{{PAGE1_DATA}}`
- `{{PAGE2_DATA}}`
- `{{LIMIT}}`

Required output shape:

- JSON array.
- 10-15 recommendation objects.

Required fields:

- `recommendation_title`
- `recommendation_text`
- `confidence_score`
- `urgency_score`
- `roi_score`
- `reasoning_summary`
- `next_action`
- `supporting_sources`
- `source_dates`
- `source_window`
- `freshness_note`
- `topic`

Backend grounding change:

- Before this update, Suggestions loaded all historical MMO and AI Tools rows.
- Now it loads only rows from `targetDate`.
- If same-day MMO or AI Tools rows are missing, it refreshes those pages first.
- Suggestions are rejected at read time unless their copied `source_dates` still fall inside `source_window`.

Storage:

- Table: `ai_suggestions`

### Product Deep Dive

Page type: `deep_dive`

Active seeded variant: `v4.0.1`

Mission:

- Analyze one selected product in detail.

Required output:

- One JSON object only.

Required fields:

- `id`
- `product_id`
- `margin_potential`
- `content_virality`
- `shipping_complexity`
- `regulatory_risk`
- `review_sentiment`
- `competitor_density_score`
- `estimated_gross_margin_percent`
- `average_market_price_usd`
- `main_keywords`
- `consumer_pain_points`
- `generated_at`
- `summary`

### Product Opportunity Plan

Page type: `opportunity`

Active seeded variant: `v4.0.1`

Mission:

- Generate one concrete action plan for a selected product.

Required output:

- JSON array with exactly one item.

Required fields:

- `id`
- `product_id`
- `recommendation_title`
- `hook`
- `execution_plan`
- `risk`
- `expected_kpi`
- `urgency_score`
- `roi_score`
- `difficulty_score`
- `time_to_first_result`
- `generated_at`
- `target_category`

### Video Script Studio

Page type: `aff_vid`

Active seeded variant: `v1`

Mission:

- Convert one Product Trend result into a short-form affiliate video plan.

Important rule:

- It must not invent another product, price, discount, review, or external proof.

### Social Post Composer

Page type: `up_post`

Active seeded variant: `v1`

Mission:

- Convert a prepared source into platform-specific post variants.

Important rule:

- Each platform must receive a materially different post body.

## Runtime Flow

Daily job:

1. `runDailyTrendResearch()` runs Product Trends for `today`, `last_3_days`, and `last_7_days`.
2. It refreshes `mmo`, `ai_tools`, and `suggestions`.
3. `suggestions` depends on same-day `mmo` and `ai_tools` rows.

Manual refresh:

1. UI calls `/api/research/refresh`.
2. For Trends, the route calls `getProductTrends()`.
3. For MMO, AI Tools, and Suggestions, the route calls `refreshLegacyResearchPageService()`.
4. Manual refresh only supports today's date.

## UI Changes

Files:

- `public/research.js`
- `public/research.css`
- `public/index.html`
- `public/research.html`

Changes:

- Default Trend V4 limit is now 15.
- Top cards are more compact.
- Group sections use smaller cards and less spacing.
- Tables use shorter line height and compact metadata.
- Source date, source link, and evidence summary appear as compact chips.
- Suggestion cards are shorter and easier to scan.
- Product Trend cards show source/evidence chips directly on the card.

## Verification Checklist

After code changes:

1. Run syntax checks:
   `node --check src/research-service.js`
   `node --check src/research-routes.js`
   `node --check public/research.js`

2. Run tests:
   `npm test -- --runInBand`

3. Seed prompts:
   `node seed_prompts.js`

4. Restart server:
   `npm run start`

5. In the UI, run Refresh AI for:
   Product Trends, MMO, AI Tools, Suggestions.

6. Confirm output:
   10-15 rows when enough evidence exists.
   No generic old entries unless they show fresh source evidence.
   Suggestions use today's MMO/AI Tools rows.
   Cards and tables are compact enough for fast comparison.
