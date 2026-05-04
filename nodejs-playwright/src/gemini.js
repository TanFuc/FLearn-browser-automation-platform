/**
 * Gemini AI Client with Free-Tier Quota Guard
 * Uses REST API directly via fetch (Node 18+)
 */
const db = require('./db');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const MODELS = {
    default: 'gemini-2.5-flash-preview-05-20',
    lite:    'gemini-2.0-flash',
};

// Defaults — can be overridden via quota_state table
const DEFAULTS = {
    softCap: parseInt(process.env.GEMINI_SOFT_CAP || '20'),
    hardCap: parseInt(process.env.GEMINI_HARD_CAP || '30'),
};

// ─── Quota helpers ─────────────────────────────────────────────────────────

async function getQuota() {
    const r = await db.query(`SELECT * FROM quota_state WHERE id = 1`);
    const row = r.rows[0];
    // Reset if it's a new day
    if (row && row.date && row.date.toISOString().slice(0,10) !== new Date().toISOString().slice(0,10)) {
        await db.query(`
            UPDATE quota_state SET
                date = CURRENT_DATE, request_count = 0, prompt_tokens = 0,
                output_tokens = 0, total_tokens = 0, cache_hits = 0,
                is_blocked = FALSE, updated_at = NOW()
            WHERE id = 1
        `);
        return (await db.query(`SELECT * FROM quota_state WHERE id = 1`)).rows[0];
    }
    return row;
}

async function incrementUsage(promptTokens, outputTokens) {
    await db.query(`
        UPDATE quota_state SET
            request_count   = request_count + 1,
            prompt_tokens   = prompt_tokens + $1,
            output_tokens   = output_tokens + $2,
            total_tokens    = total_tokens + $1 + $2,
            last_successful_run = NOW(),
            updated_at      = NOW()
        WHERE id = 1
    `, [promptTokens, outputTokens]);
}

async function incrementCacheHit() {
    await db.query(`UPDATE quota_state SET cache_hits = cache_hits + 1, updated_at = NOW() WHERE id = 1`);
}

async function setBlocked(blocked) {
    await db.query(`UPDATE quota_state SET is_blocked = $1, updated_at = NOW() WHERE id = 1`, [blocked]);
}

async function isQuotaSafe(useLite = false) {
    const quota = await getQuota();
    if (!quota) return true;
    const cap = useLite ? quota.hard_cap : quota.soft_cap;
    if (quota.request_count >= quota.hard_cap) {
        if (!quota.is_blocked) await setBlocked(true);
        return false;
    }
    if (quota.request_count >= quota.soft_cap && !useLite) return false;
    return true;
}

// ─── Core call ─────────────────────────────────────────────────────────────

async function callGemini(prompt, { useLite = false, endpoint = 'unknown' } = {}) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

    const safe = await isQuotaSafe(useLite);
    if (!safe) {
        throw new Error('QUOTA_EXCEEDED: Gemini daily request limit reached. Try again tomorrow.');
    }

    const model = useLite ? MODELS.lite : MODELS.default;
    const url = `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 4096,
            responseMimeType: 'application/json',
        },
    };

    let res;
    try {
        res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
        });
    } catch (netErr) {
        throw new Error(`Network error calling Gemini: ${netErr.message}`);
    }

    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`Gemini API error ${res.status}: ${errText}`);
    }

    const json = await res.json();
    const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
    const usage = json?.usageMetadata || {};

    const promptTokens = usage.promptTokenCount || 0;
    const outputTokens = usage.candidatesTokenCount || 0;

    // Log usage to DB
    await incrementUsage(promptTokens, outputTokens);
    await db.query(
        `INSERT INTO api_usage_logs (model, prompt_tokens, output_tokens, total_tokens, cache_hit, endpoint)
         VALUES ($1, $2, $3, $4, FALSE, $5)`,
        [model, promptTokens, outputTokens, promptTokens + outputTokens, endpoint]
    );

    // Parse JSON response
    try {
        // Strip markdown code fences if present
        const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
        return JSON.parse(cleaned);
    } catch {
        return { raw: text };
    }
}

module.exports = { callGemini, getQuota, isQuotaSafe, incrementCacheHit, setBlocked };
