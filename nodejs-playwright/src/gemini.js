/**
 * Gemini AI Client
 */

const crypto = require('crypto');
const db = require('./db');
const { emitSystemLog } = require('./logger');

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
    const source = String(text || '');
    const candidates = [];
    const fenced = source.match(/```(?:json)?\s*([\s\S]*?)\s*```/gi) || [];
    for (const block of fenced) {
        candidates.push(block.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim());
    }
    candidates.push(source.trim());

    function balancedJsonSlice(input) {
        const starts = [input.indexOf('['), input.indexOf('{')].filter(i => i >= 0).sort((a, b) => a - b);
        for (const start of starts) {
            const open = input[start];
            const close = open === '[' ? ']' : '}';
            let depth = 0;
            let inString = false;
            let escape = false;
            for (let i = start; i < input.length; i++) {
                const ch = input[i];
                if (escape) {
                    escape = false;
                    continue;
                }
                if (ch === '\\') {
                    escape = true;
                    continue;
                }
                if (ch === '"') {
                    inString = !inString;
                    continue;
                }
                if (inString) continue;
                if (ch === open) depth += 1;
                if (ch === close) depth -= 1;
                if (depth === 0) return input.slice(start, i + 1);
            }
        }
        return null;
    }

    for (const candidate of candidates) {
        if (!candidate) continue;
        try {
            return JSON.parse(candidate);
        } catch (e) {
            const slice = balancedJsonSlice(candidate);
            if (slice) {
                try {
                    return JSON.parse(slice);
                } catch (e2) {}
            }
        }
    }

    try {
        const jsonMatch = source.match(/```json\s*([\s\S]*?)\s*```/) || source.match(/```\s*([\s\S]*?)\s*```/);
        const cleaned = jsonMatch ? jsonMatch[1].trim() : text.trim();
        return JSON.parse(cleaned);
    } catch (e) {
        try {
            const startArr = source.indexOf('[');
            const startObj = source.indexOf('{');
            let start = -1, end = -1;
            if (startArr !== -1 && (startObj === -1 || startArr < startObj)) {
                start = startArr; end = source.lastIndexOf(']') + 1;
            } else if (startObj !== -1) {
                start = startObj; end = source.lastIndexOf('}') + 1;
            }
            if (start !== -1 && end > start) return JSON.parse(source.substring(start, end));
        } catch (e2) {}
        return { raw: source };
    }
}

const GROUNDED_ENDPOINTS = new Set([
    'product_trends',
    'mmo',
    'ai_tools',
]);

function shouldEnableGoogleSearch(endpoint, explicitValue) {
    if (explicitValue !== undefined) return !!explicitValue;
    if (process.env.GEMINI_ENABLE_GOOGLE_SEARCH === 'false') return false;
    return GROUNDED_ENDPOINTS.has(endpoint);
}

async function callGeminiAPI(prompt, model, { googleSearch = false } = {}) {
    const url = `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;
    const body = {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.4, maxOutputTokens: 8192 },
    };
    if (googleSearch) {
        body.tools = [{ google_search: {} }];
    } else {
        body.generationConfig.responseMimeType = 'application/json';
    }

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

async function callGemini(prompt, { endpoint = 'unknown', skipCache = false, useLite = undefined, googleSearch = undefined } = {}) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing');
    const promptHash = sha256(prompt);
    await emitSystemLog('Gemini request prepared', 'info', { endpoint, skipCache, prompt_hash: promptHash.slice(0, 12) });

    if (!skipCache) {
        const cached = await getCache(promptHash);
        if (cached) {
            await incrementCacheHit();
            await emitSystemLog('Gemini cache hit', 'info', { endpoint, prompt_hash: promptHash.slice(0, 12) });
            return cached.payload_json;
        }
    }

    const reserved = await reserveQuota();
    if (!reserved) {
        await emitSystemLog('Gemini quota reservation failed', 'warning', { endpoint });
        throw new Error('QUOTA_EXCEEDED');
    }

    try {
        const quota = await getQuota();
        const model = useLite === true ? MODELS.lite : chooseModel(quota);
        await emitSystemLog('Gemini API call started', 'info', {
            endpoint,
            model,
            google_search: shouldEnableGoogleSearch(endpoint, googleSearch)
        });
        const response = await callGeminiAPI(prompt, model, {
            googleSearch: shouldEnableGoogleSearch(endpoint, googleSearch)
        });

        const parts = response?.candidates?.[0]?.content?.parts || [];
        const text = parts.map(part => part.text || '').filter(Boolean).join('\n').trim() || '{}';
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
        await emitSystemLog('Gemini API call completed', 'success', {
            endpoint,
            model,
            prompt_tokens: promptTokens,
            output_tokens: outputTokens,
            total_tokens: promptTokens + outputTokens
        });

        return parsed;
    } catch (error) {
        await rollbackQuotaReservation();
        await emitSystemLog('Gemini API call failed', 'error', { endpoint, error: error.message });
        throw error;
    }
}

async function setBlocked(blocked) {
    const db = require('./db');
    await db.query('UPDATE quota_state SET is_blocked = $1 WHERE id = 1', [blocked]);
}

module.exports = { callGemini, getQuota, setSocketEmitter, incrementCacheHit, setBlocked };
