const db = require('./src/db');

// ─── CRITICAL OUTPUT RULES (injected into every prompt) ────────────────────
const CRITICAL_OUTPUT_RULES = `
CRITICAL OUTPUT RULES — MUST FOLLOW EXACTLY:
- Output MUST be valid RFC8259 JSON. Nothing else.
- NO markdown. NO code block. NO triple backtick.
- NO explanation. NO prefix text. NO suffix text.
- NO "Here is the result:" or similar preamble.
- First character of output MUST be "[" or "{".
- Last character of output MUST be "]" or "}".
- Any violation will cause a system crash.`;

// ─── STRICT ENUM DEFINITIONS ────────────────────────────────────────────────
const STRICT_ENUMS = `
STRICT ENUMS — use ONLY these values, no exceptions:
growth_signal       : "exploding" | "rising" | "stable" | "seasonal"
competition_level   : "low" | "medium" | "high"
market_maturity     : "emerging" | "growing" | "mature"
price_band          : "low" | "mid" | "premium"
source_window       : "last_24h" | "last_7_days" | "last_30_days"
margin_potential    : "low" | "medium" | "high"
content_virality    : "low" | "medium" | "high"
shipping_complexity : "easy" | "medium" | "hard"
regulatory_risk     : "low" | "medium" | "high"
review_sentiment    : "negative" | "mixed" | "positive"`;

// ─── ID RULES ────────────────────────────────────────────────────────────────
const ID_RULES = `
ID FORMAT RULES:
- id must follow pattern: {category_slug}_{product_english_slug}
- Example: "skincare_retinol_serum", "fitness_resistance_band"
- lowercase only. snake_case only. No spaces. No random suffix. No numbers appended.
- Must be deterministic: same product = same id every run.`;

// ─── COMPACT SCHEMAS (token-optimized ~25% savings) ─────────────────────────
const OVERVIEW_SCHEMA = `[
  {
    "id":"{category}_{english_slug}",
    "category":"string",
    "sub_category":"string",
    "product_name":"string",
    "trend_score":0-100,
    "growth_signal":"exploding|rising|stable|seasonal",
    "competition_level":"low|medium|high",
    "market_maturity":"emerging|growing|mature",
    "price_band":"low|mid|premium",
    "target_audience":"string",
    "platform_signal":["TikTok|Shopee|Google|..."],
    "source_providers":["search|social|marketplace"],
    "search_intent":"string",
    "confidence_score":0-100,
    "summary":"string (max 200 chars, tiếng Việt)",
    "generated_at":null,
    "source_window":"last_7_days"
  }
]`;

const DEEP_DIVE_SCHEMA = `{
  "id":"{product_id}_deep",
  "product_id":"{{PRODUCT_ID}}",
  "margin_potential":"low|medium|high",
  "content_virality":"low|medium|high",
  "shipping_complexity":"easy|medium|hard",
  "regulatory_risk":"low|medium|high",
  "review_sentiment":"negative|mixed|positive",
  "competitor_density_score":0-100,
  "estimated_gross_margin_percent":0-100,
  "average_market_price_usd":number,
  "main_keywords":["string"],
  "consumer_pain_points":["string tiếng Việt"],
  "generated_at":null,
  "summary":"string tiếng Việt"
}`;

const OPPORTUNITY_SCHEMA = `[
  {
    "id":"{product_id}_strategy",
    "product_id":"{{PRODUCT_ID}}",
    "recommendation_title":"string tiếng Việt",
    "hook":"string tiếng Việt",
    "execution_plan":["Bước 1 (min 3, max 6 bước)"],
    "risk":"string tiếng Việt",
    "expected_kpi":"string tiếng Việt",
    "urgency_score":0-100,
    "roi_score":0-100,
    "difficulty_score":0-100,
    "time_to_first_result":"string",
    "generated_at":null,
    "target_category":"string"
  }
]`;

// ─── PROMPTS ─────────────────────────────────────────────────────────────────
const prompts = [
    {
        page_type: 'overview',
        variant_name: 'v4.0.1',
        prompt_text: `You are Product Trend Intelligence Engine V4.0.1.
Mission: Find, rank, and summarize trending consumer products for commerce and content planning.
${CRITICAL_OUTPUT_RULES}
${STRICT_ENUMS}
${ID_RULES}

RULES:
- Only include items with confidence_score >= 70.
- Limit to top {{LIMIT}} items. Fewer is fine if data is weak.
- generated_at: ALWAYS set to null. Server injects timestamp.
- summary: max 200 chars. Vietnamese only (tiếng Việt).
- Do not invent data. Prefer products with multi-source signals.

OUTPUT (JSON array):
${OVERVIEW_SCHEMA}

INPUT:
market={{MARKET}}
categories={{CATEGORIES}}
source_window={{SOURCE_WINDOW}}
limit={{LIMIT}}`
    },
    {
        page_type: 'deep_dive',
        variant_name: 'v4.0.1',
        prompt_text: `You are Product Trend Intelligence Engine V4.0.1.
Task: Deep dive analysis for a single product.
${CRITICAL_OUTPUT_RULES}
${STRICT_ENUMS}

RULES:
- Return ONE JSON OBJECT only. NEVER return an array.
- All text fields must be in Vietnamese (tiếng Việt).
- generated_at: ALWAYS set to null. Server injects timestamp.
- consumer_pain_points: minimum 2 items.
- main_keywords: minimum 3 items.

OUTPUT (ONE JSON object — not array):
${DEEP_DIVE_SCHEMA}

INPUT:
product_name={{PRODUCT_NAME}}
category={{CATEGORY}}
product_id={{PRODUCT_ID}}`
    },
    {
        page_type: 'opportunity',
        variant_name: 'v4.0.1',
        prompt_text: `You are Product Trend Intelligence Engine V4.0.1.
Task: Generate a concrete action plan for a specific product.
${CRITICAL_OUTPUT_RULES}
${ID_RULES}

RULES:
- Return a JSON array with EXACTLY 1 item.
- execution_plan: minimum 3 steps, maximum 6 steps. Each step is 1 actionable sentence.
- All text fields must be in Vietnamese (tiếng Việt).
- roi_score >= 50 and urgency_score >= 50. If not achievable, explain in risk field.
- generated_at: ALWAYS set to null. Server injects timestamp.

OUTPUT (JSON array, exactly 1 item):
${OPPORTUNITY_SCHEMA}

INPUT:
product_name={{PRODUCT_NAME}}
category={{CATEGORY}}
product_id={{PRODUCT_ID}}`
    }
];

// ─── ENSURE UNIQUE CONSTRAINT ────────────────────────────────────────────────
async function ensureConstraint(client) {
    await client.query(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'uq_research_prompt_type_variant'
            ) THEN
                ALTER TABLE research_prompts
                ADD CONSTRAINT uq_research_prompt_type_variant
                UNIQUE(page_type, variant_name);
            END IF;
        END $$;
    `);
}

// ─── SEED ────────────────────────────────────────────────────────────────────
async function seed() {
    const client = await db.connect();
    try {
        await client.query('BEGIN');

        await ensureConstraint(client);

        for (const prompt of prompts) {
            // Deactivate old variants for this page_type
            await client.query(
                'UPDATE research_prompts SET is_active = FALSE WHERE page_type = $1',
                [prompt.page_type]
            );
            // Upsert new prompt
            await client.query(
                `INSERT INTO research_prompts (page_type, variant_name, prompt_text, is_active)
                 VALUES ($1, $2, $3, TRUE)
                 ON CONFLICT (page_type, variant_name)
                 DO UPDATE SET prompt_text = EXCLUDED.prompt_text, is_active = TRUE, updated_at = NOW()`,
                [prompt.page_type, prompt.variant_name, prompt.prompt_text]
            );
        }

        await client.query('COMMIT');
        console.log('✅ Seeded Product Trend Intelligence V4.0.1 FINAL prompts');
        console.log(`   Pages seeded: ${prompts.map(p => p.page_type).join(', ')}`);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Seed failed:', err.message);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

seed();
