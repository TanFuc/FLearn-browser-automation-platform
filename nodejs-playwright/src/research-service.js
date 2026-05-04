/**
 * Research Service
 * - Checks DB cache first (24h TTL)
 * - Calls Gemini only when data is stale/missing
 * - Stores results to PostgreSQL for reuse
 */
const db = require('./db');
const { callGemini, incrementCacheHit } = require('./gemini');

const SEED_TOPICS = ['Skincare', 'Home Appliances', 'Fitness', 'Fashion', 'Mother and Baby'];

// ─── Cache helpers ─────────────────────────────────────────────────────────

async function getCached(topic, pageType) {
    const r = await db.query(
        `SELECT data FROM cached_research
         WHERE topic = $1 AND page_type = $2 AND expires_at > NOW()`,
        [topic, pageType]
    );
    return r.rows[0]?.data || null;
}

async function setCache(topic, pageType, data) {
    await db.query(
        `INSERT INTO cached_research (topic, page_type, data, expires_at)
         VALUES ($1, $2, $3, NOW() + INTERVAL '24 hours')
         ON CONFLICT (topic, page_type)
         DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
        [topic, pageType, JSON.stringify(data)]
    );
}

// ─── Page 1: MMO / Affiliate Intelligence ──────────────────────────────────

async function researchMMO(topics = SEED_TOPICS) {
    const cacheKey = topics.join(',');
    const cached = await getCached(cacheKey, 'mmo');
    if (cached) { await incrementCacheHit(); return cached; }

    const prompt = `You are an expert MMO and affiliate marketing analyst. Research these niches and return a JSON array of opportunities.

Niches: ${topics.join(', ')}

Return ONLY a JSON array. Each item must have these exact fields:
{
  "title": "short opportunity title",
  "category": "niche name",
  "trend_score": 1-100,
  "monetization_score": 1-100,
  "competition_score": 1-100,
  "content_angle": "suggested content angle",
  "traffic_source": "main traffic source",
  "monetization_model": "how to monetize",
  "summary": "2-3 sentence summary"
}

Generate 2-3 items per niche. Focus on 2025 trends. Return strict JSON only, no markdown.`;

    const data = await callGemini(prompt, { endpoint: 'mmo' });
    const results = Array.isArray(data) ? data : (data.items || data.opportunities || []);

    // Store to research_results
    await db.query(`DELETE FROM research_results WHERE page_type = 'mmo'`);
    for (const item of results) {
        await db.query(
            `INSERT INTO research_results (topic, page_type, title, category, data, trend_score, monetization_score, competition_score)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [item.category || 'general', 'mmo', item.title, item.category, JSON.stringify(item),
             item.trend_score || 0, item.monetization_score || 0, item.competition_score || 0]
        );
    }
    await setCache(cacheKey, 'mmo', results);
    return results;
}

// ─── Page 2: AI Tool Intelligence ──────────────────────────────────────────

async function researchAITools() {
    const cached = await getCached('ai_tools', 'ai_tools');
    if (cached) { await incrementCacheHit(); return cached; }

    const prompt = `You are an AI industry analyst. Provide a current snapshot of the AI tools market in 2025.

Return ONLY a JSON array of AI tools and market signals. Each item must have:
{
  "tool_name": "tool name",
  "tool_type": "code|video|writing|automation|image|other",
  "use_case": "primary use case",
  "best_value_reason": "why it's good value",
  "discount_or_launch_status": "new_launch|on_discount|established|deprecated",
  "market_signal": "brief market insight",
  "price_level": "free|freemium|paid|enterprise",
  "summary": "2-3 sentence summary",
  "is_best_value": true|false,
  "is_new_noteworthy": true|false
}

Include at least 3 tools for each type: code, video, writing, automation. Return strict JSON array only.`;

    const data = await callGemini(prompt, { endpoint: 'ai_tools' });
    const results = Array.isArray(data) ? data : (data.items || data.tools || []);

    await db.query(`DELETE FROM research_results WHERE page_type = 'ai_tools'`);
    for (const item of results) {
        await db.query(
            `INSERT INTO research_results (topic, page_type, title, category, data)
             VALUES ($1, $2, $3, $4, $5)`,
            ['ai_tools', 'ai_tools', item.tool_name, item.tool_type, JSON.stringify(item)]
        );
    }
    await setCache('ai_tools', 'ai_tools', results);
    return results;
}

// ─── Page 3: AI Suggestions ────────────────────────────────────────────────

async function researchSuggestions(topics = SEED_TOPICS) {
    const cacheKey = topics.join(',');
    const cached = await getCached(cacheKey, 'suggestions');
    if (cached) { await incrementCacheHit(); return cached; }

    const prompt = `You are an AI business strategy advisor. Based on these niches and the current 2025 market, provide concrete actionable recommendations.

Niches: ${topics.join(', ')}

Return ONLY a JSON array. Each item must have:
{
  "recommendation_title": "short title",
  "recommendation_text": "detailed recommendation",
  "confidence_score": 1-100,
  "urgency_score": 1-100,
  "roi_score": 1-100,
  "reasoning_summary": "why this matters now",
  "next_action": "first concrete step to take",
  "topic": "related niche"
}

Generate 8-12 diverse recommendations covering: niches, tools, content ideas, affiliate offers, traffic methods. Return strict JSON array only.`;

    const data = await callGemini(prompt, { endpoint: 'suggestions' });
    const results = Array.isArray(data) ? data : (data.items || data.recommendations || []);

    await db.query(`DELETE FROM ai_suggestions`);
    for (const item of results) {
        await db.query(
            `INSERT INTO ai_suggestions (recommendation_title, recommendation_text, confidence_score, urgency_score, roi_score, reasoning_summary, next_action, topic)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [item.recommendation_title, item.recommendation_text,
             item.confidence_score || 0, item.urgency_score || 0, item.roi_score || 0,
             item.reasoning_summary, item.next_action, item.topic]
        );
    }
    await setCache(cacheKey, 'suggestions', results);
    return results;
}

// ─── Batch daily research job ───────────────────────────────────────────────

async function runDailyResearch() {
    console.log('[Research] Starting daily research job...');
    await db.query(`UPDATE quota_state SET last_cron_run = NOW() WHERE id = 1`);

    const topicsRes = await db.query(`SELECT name FROM research_topics WHERE is_active = TRUE ORDER BY id`);
    const topics = topicsRes.rows.map(r => r.name);
    if (topics.length === 0) topics.push(...SEED_TOPICS);

    try {
        console.log('[Research] Running MMO research...');
        await researchMMO(topics);
        console.log('[Research] Running AI Tools research...');
        await researchAITools();
        console.log('[Research] Running Suggestions...');
        await researchSuggestions(topics);
        console.log('[Research] Daily job complete ✅');
    } catch (err) {
        console.error('[Research] Daily job error:', err.message);
    }
}

// ─── Read from DB (fast path, no AI) ───────────────────────────────────────

async function getMMOFromDB() {
    const r = await db.query(
        `SELECT data FROM research_results WHERE page_type = 'mmo' ORDER BY created_at DESC LIMIT 50`
    );
    return r.rows.map(row => row.data);
}

async function getAIToolsFromDB() {
    const r = await db.query(
        `SELECT data FROM research_results WHERE page_type = 'ai_tools' ORDER BY created_at DESC LIMIT 50`
    );
    return r.rows.map(row => row.data);
}

async function getSuggestionsFromDB() {
    const r = await db.query(
        `SELECT * FROM ai_suggestions ORDER BY roi_score DESC, confidence_score DESC LIMIT 30`
    );
    return r.rows;
}

module.exports = {
    researchMMO, researchAITools, researchSuggestions,
    runDailyResearch, getMMOFromDB, getAIToolsFromDB, getSuggestionsFromDB,
};
