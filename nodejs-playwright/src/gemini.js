/**
 * Gemini AI Client
 */

const crypto = require('crypto');
const db = require('./db');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

const BASE_URL =
    'https://generativelanguage.googleapis.com/v1beta/models';

const MODELS = {
    default: 'gemini-2.5-flash',
    lite: 'gemini-2.5-flash-lite',
};

const DEFAULTS = {
    softCap: parseInt(process.env.GEMINI_SOFT_CAP || '20'),
    hardCap: parseInt(process.env.GEMINI_HARD_CAP || '30'),
    softTokenCap: parseInt(process.env.GEMINI_SOFT_TOKEN_CAP || '100000'),
    hardTokenCap: parseInt(process.env.GEMINI_HARD_TOKEN_CAP || '200000'),
    cacheTTLHours: 24,
};

let socketIO = null;

function setSocketEmitter(io) {
    socketIO = io;
}

function emitQuotaUpdate(quota) {
    if (socketIO) {
        socketIO.emit('quota:update', quota);
    }
}

function sha256(input) {
    return crypto.createHash('sha256').update(input).digest('hex');
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryable(status) {
    return [429, 500, 502, 503, 504].includes(status);
}

async function getCache(promptHash) {
    const result = await db.query(
        `SELECT payload_json FROM cached_research WHERE cache_key = $1 AND expires_at > NOW() LIMIT 1`,
        [promptHash]
    );
    return result.rows[0] || null;
}

async function setCache(promptHash, payload) {
    await db.query(
        `INSERT INTO cached_research (cache_key, payload_json, expires_at, created_at, updated_at)
         VALUES ($1, $2, NOW() + INTERVAL '24 hours', NOW(), NOW())
         ON CONFLICT (cache_key) DO UPDATE SET payload_json = EXCLUDED.payload_json, expires_at = EXCLUDED.expires_at, updated_at = NOW()`,
        [promptHash, JSON.stringify(payload)]
    );
}

async function resetQuotaIfNeeded() {
    await db.query(`UPDATE quota_state SET date = CURRENT_DATE, request_count = 0, prompt_tokens = 0, output_tokens = 0, total_tokens = 0, cache_hits = 0, is_blocked = FALSE, updated_at = NOW() WHERE id = 1 AND date < CURRENT_DATE`);
}

async function getQuota() {
    await resetQuotaIfNeeded();
    const result = await db.query(`SELECT * FROM quota_state WHERE id = 1 LIMIT 1`);
    return result.rows[0];
}

async function incrementCacheHit() {
    await db.query(`UPDATE quota_state SET cache_hits = cache_hits + 1, updated_at = NOW() WHERE id = 1`);
}

async function reserveQuota() {
    await resetQuotaIfNeeded();
    const result = await db.query(
        `UPDATE quota_state SET request_count = request_count + 1, updated_at = NOW() WHERE id = 1 AND is_blocked = FALSE AND request_count < hard_cap AND total_tokens < hard_token_cap RETURNING *`
    );
    return result.rows[0] || null;
}

async function rollbackQuotaReservation() {
    await db.query(`UPDATE quota_state SET request_count = GREATEST(request_count - 1, 0) WHERE id = 1`);
}

async function finalizeUsage(promptTokens, outputTokens) {
    await db.query(
        `UPDATE quota_state SET prompt_tokens = prompt_tokens + $1, output_tokens = output_tokens + $2, total_tokens = total_tokens + $1 + $2, last_successful_run = NOW(), updated_at = NOW() WHERE id = 1`,
        [promptTokens, outputTokens]
    );
    const quota = await getQuota();
    emitQuotaUpdate(quota);
}

function chooseModel(quota) {
    const ratio = quota.request_count / quota.hard_cap;
    return ratio >= 0.7 ? MODELS.lite : MODELS.default;
}

async function parseGeminiResponse(text) {
    try {
        const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/) || text.match(/```\s*([\s\S]*?)\s*```/);
        const cleaned = jsonMatch ? jsonMatch[1].trim() : text.trim();
        return JSON.parse(cleaned);
    } catch (e) {
        try {
            const startArr = text.indexOf('[');
            const startObj = text.indexOf('{');
            let start = -1, end = -1;
            if (startArr !== -1 && (startObj === -1 || startArr < startObj)) {
                start = startArr; end = text.lastIndexOf(']') + 1;
            } else if (startObj !== -1) {
                start = startObj; end = text.lastIndexOf('}') + 1;
            }
            if (start !== -1 && end > start) return JSON.parse(text.substring(start, end));
        } catch (e2) {}
        return { raw: text };
    }
}

async function callGeminiAPI(prompt, model) {
    const url = `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192, responseMimeType: 'application/json' },
    };

    let lastError = null;
    for (let i = 0; i < 3; i++) {
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (!response.ok) {
                const errText = await response.text();
                lastError = new Error(`Gemini API ${response.status}: ${errText}`);
                if (isRetryable(response.status)) {
                    await sleep(1000 * (i + 1));
                    continue;
                }
                throw lastError;
            }

            return await response.json();
        } catch (error) {
            lastError = error;
            if (i < 2) await sleep(1000 * (i + 1));
        }
    }
    throw lastError || new Error('Unknown Gemini API Error');
}

async function callGemini(prompt, { endpoint = 'unknown', skipCache = false, useLite = undefined } = {}) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');
    const promptHash = sha256(prompt);

    if (!skipCache) {
        const cached = await getCache(promptHash);
        if (cached) {
            await incrementCacheHit();
            return cached.payload_json;
        }
    }

    const reserved = await reserveQuota();
    if (!reserved) throw new Error('QUOTA_EXCEEDED');

    try {
        const quota = await getQuota();
        const model = useLite === true ? MODELS.lite : chooseModel(quota);
        const response = await callGeminiAPI(prompt, model);

        const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '{}';
        const usage = response?.usageMetadata || {};
        const promptTokens = usage.promptTokenCount || 0;
        const outputTokens = usage.candidatesTokenCount || 0;

        const parsed = await parseGeminiResponse(text);
        await finalizeUsage(promptTokens, outputTokens);
        await setCache(promptHash, parsed);

        await db.query(
            `INSERT INTO api_usage_logs (model, prompt_tokens, output_tokens, total_tokens, cache_hit, endpoint) VALUES ($1, $2, $3, $4, FALSE, $5)`,
            [model, promptTokens, outputTokens, promptTokens + outputTokens, endpoint]
        );

        return parsed;
    } catch (error) {
        await rollbackQuotaReservation();
        throw error;
    }
}

async function setBlocked(blocked) {
    const db = require('./db');
    await db.query('UPDATE quota_state SET is_blocked = $1 WHERE id = 1', [blocked]);
}

module.exports = { callGemini, getQuota, setSocketEmitter, incrementCacheHit, setBlocked };
