/**
 * Gemini AI Client with Free-Tier Quota Guard
 * Uses REST API directly via fetch (Node 18+)
 */
const crypto = require('crypto');
const db = require('./db');

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';
const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';

const MODEL_PRIORITY = [
    'gemini-2.5-flash-lite',
    'gemini-2.0-flash',
    'gemini-2.5-flash'
];

let socketEmitter = null;

function setSocketEmitter(io) {
    socketEmitter = io || null;
}

function emitSocket(event, payload) {
    if (socketEmitter && typeof socketEmitter.emit === 'function') {
        socketEmitter.emit(event, payload);
    }
}

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
    if (row && row.date && row.date.toISOString().slice(0, 10) !== new Date().toISOString().slice(0, 10)) {
        await db.query(`
            UPDATE quota_state SET
                date = CURRENT_DATE, request_count = 0, prompt_tokens = 0,
                output_tokens = 0, total_tokens = 0, cache_hits = 0,
                is_blocked = FALSE, blocked_until = NULL, updated_at = NOW()
            WHERE id = 1
        `);
        return (await db.query(`SELECT * FROM quota_state WHERE id = 1`)).rows[0];
    }
    return row;
}

async function incrementUsage(promptTokens, outputTokens, model) {
    await db.query(`
        UPDATE quota_state SET
            request_count   = request_count + 1,
            prompt_tokens   = prompt_tokens + $1,
            output_tokens   = output_tokens + $2,
            total_tokens    = total_tokens + $1 + $2,
            last_model      = $3,
            last_successful_run = NOW(),
            updated_at      = NOW()
        WHERE id = 1
    `, [promptTokens, outputTokens, model || null]);
}

async function incrementCacheHit() {
    await db.query(`UPDATE quota_state SET cache_hits = cache_hits + 1, updated_at = NOW() WHERE id = 1`);
}

async function setBlocked(blocked, blockedUntil = null, blockedModel = null) {
    await db.query(
        `UPDATE quota_state SET is_blocked = $1, blocked_until = $2, blocked_model = $3, updated_at = NOW() WHERE id = 1`,
        [blocked, blockedUntil, blockedModel]
    );
}

async function isQuotaSafe(useLite = false) {
    const quota = await getQuota();
    if (!quota) return true;
    if (quota.blocked_until && new Date(quota.blocked_until).getTime() > Date.now()) {
        if (!quota.blocked_model) return false;
    }
    const cap = useLite ? quota.hard_cap : quota.soft_cap;
    if (quota.request_count >= quota.hard_cap) {
        if (!quota.is_blocked) await setBlocked(true, quota.blocked_until || null, quota.blocked_model || null);
        return false;
    }
    if (quota.request_count >= quota.soft_cap && !useLite) return false;
    return true;
}

function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function isRetryableStatus(status) {
    return [429, 500, 502, 503, 504].includes(status);
}
function parseQuotaExhausted(errText) {
    try {
        const data = JSON.parse(errText);
        const details = data?.error?.details || [];
        const quotaFailure = details.find(d => d['@type']?.includes('QuotaFailure'));
        const retryInfo = details.find(d => d['@type']?.includes('RetryInfo'));
        const violation = quotaFailure?.violations?.[0] || {};
        const quotaValue = parseInt(violation.quotaValue || '', 10);
        const model = violation.quotaDimensions?.model || null;
        const retryDelay = retryInfo?.retryDelay || '';
        const retrySeconds = retryDelay.endsWith('s') ? parseFloat(retryDelay.replace('s', '')) : 0;
        return {
            model,
            quotaValue: Number.isFinite(quotaValue) ? quotaValue : null,
            retryDelaySeconds: Number.isFinite(retrySeconds) ? retrySeconds : 0,
        };
    } catch {
        return { model: null, quotaValue: null, retryDelaySeconds: 0 };
    }
}

async function syncQuotaFrom429(errText, model) {
    const parsed = parseQuotaExhausted(errText);
    if (!parsed.quotaValue) return null;
    const hardCap = parsed.quotaValue;
    const softCap = Math.max(1, Math.floor(hardCap * 0.7));
    const retrySeconds = parsed.retryDelaySeconds || 0;
    const blockedUntil = retrySeconds > 0 ? new Date(Date.now() + retrySeconds * 1000) : null;
    await db.query(`
        UPDATE quota_state SET
            soft_cap = $1,
            hard_cap = $2,
            is_blocked = TRUE,
            blocked_until = $3,
            blocked_model = $4,
            updated_at = NOW()
        WHERE id = 1
    `, [softCap, hardCap, blockedUntil, model || parsed.model]);
    const state = await getQuota();
    emitSocket('quota:update', state);
    emitSocket('quota:blocked', { retry_after: retrySeconds, model: parsed.model });
    return { ...parsed, blockedUntil };
}

function isRetryableError(err) {
    if (!err) return false;
    if (err.isNetworkError) return true;
    if (typeof err.status === 'number') return isRetryableStatus(err.status);
    return false;
}

function hashPrompt(prompt) {
    return crypto.createHash('sha256').update(String(prompt || '')).digest('hex');
}

async function logAttempt({ endpoint, promptHash, model, attempt, status, success, errorMessage }) {
    try {
        await db.query(
            `INSERT INTO ai_request_attempts
             (endpoint, prompt_hash, model_name, attempt_number, response_status, success, error_message)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [endpoint, promptHash, model, attempt, status, success, errorMessage || null]
        );
    } catch (err) {
        console.warn('[Gemini] Failed to log attempt:', err.message);
    }
}

// ─── Core call ─────────────────────────────────────────────────────────────

async function callGemini(prompt, { useLite = true, endpoint = 'unknown' } = {}) {
    if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY not set in .env');

    const quota = await getQuota();
    if (quota?.blocked_until && new Date(quota.blocked_until).getTime() > Date.now()) {
        if (!quota.blocked_model) {
            throw new Error('QUOTA_BLOCKED: Retry later.');
        }
    }

    const canUseFull = await isQuotaSafe(false);
    const canUseLite = await isQuotaSafe(true);
    if (!canUseFull && !canUseLite) {
        throw new Error('QUOTA_EXCEEDED: Gemini daily request limit reached. Try again tomorrow.');
    }

    const promptHash = hashPrompt(prompt);
    let lastError = null;

    for (let m = 0; m < MODEL_PRIORITY.length; m += 1) {
        const model = MODEL_PRIORITY[m];
        if (quota?.blocked_until && new Date(quota.blocked_until).getTime() > Date.now()) {
            if (quota.blocked_model && quota.blocked_model === model) {
                continue;
            }
        }
        const url = `${BASE_URL}/${model}:generateContent?key=${GEMINI_API_KEY}`;

        if (m > 0) {
            emitSocket('ai:model_fallback', { model, attempt: 1, endpoint, status: 'fallback' });
            emitSocket('quota:model_fallback', { model, endpoint });
        }

        for (let attempt = 1; attempt <= 3; attempt += 1) {
            emitSocket('ai:model_attempt', { model, attempt, endpoint, status: 'start' });

            let res;
            try {
                const body = {
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature: 0.4,
                        maxOutputTokens: 1024,
                        responseMimeType: 'application/json',
                    },
                };

                res = await fetch(url, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(body),
                });
            } catch (netErr) {
                const err = { isNetworkError: true, message: netErr.message };
                lastError = err;
                await logAttempt({
                    endpoint,
                    promptHash,
                    model,
                    attempt,
                    status: null,
                    success: false,
                    errorMessage: `Network error: ${netErr.message}`
                });
                emitSocket('ai:model_failed', { model, attempt, endpoint, status: 'network_error' });
                if (attempt < 3) {
                    await sleep(attempt === 1 ? 1000 : 2000);
                    continue;
                }
                break;
            }

            if (!res.ok) {
                const errText = await res.text();
                const err = { status: res.status, message: errText };
                lastError = err;
                await logAttempt({
                    endpoint,
                    promptHash,
                    model,
                    attempt,
                    status: res.status,
                    success: false,
                    errorMessage: errText
                });
                emitSocket('ai:model_failed', { model, attempt, endpoint, status: res.status });

                if (res.status === 429 && errText.includes('RESOURCE_EXHAUSTED')) {
                    await syncQuotaFrom429(errText, model);
                    break;
                }

                if (isRetryableStatus(res.status) && attempt < 3) {
                    await sleep(attempt === 1 ? 1000 : 2000);
                    continue;
                }
                break;
            }

            const json = await res.json();
            const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const usage = json?.usageMetadata || {};

            const promptTokens = usage.promptTokenCount || 0;
            const outputTokens = usage.candidatesTokenCount || 0;

            await logAttempt({
                endpoint,
                promptHash,
                model,
                attempt,
                status: res.status,
                success: true,
                errorMessage: null
            });

            // Log usage to DB only on success
            await incrementUsage(promptTokens, outputTokens, model);
            await db.query(
                `INSERT INTO api_usage_logs (model, prompt_tokens, output_tokens, total_tokens, cache_hit, endpoint)
                 VALUES ($1, $2, $3, $4, FALSE, $5)`,
                [model, promptTokens, outputTokens, promptTokens + outputTokens, endpoint]
            );

            emitSocket('ai:model_success', { model, attempt, endpoint, status: res.status });
            emitSocket('quota:update', await getQuota());

            // Parse JSON response
            try {
                const cleaned = text.replace(/^```json\s*/i, '').replace(/```\s*$/i, '').trim();
                return JSON.parse(cleaned);
            } catch {
                const extracted = tryExtractJson(text);
                if (extracted) return extracted;
                return { raw: text };
            }
        }

        if (lastError && !isRetryableError(lastError)) {
            break;
        }
    }

    const errMsg = lastError?.status
        ? `Gemini API error ${lastError.status}: ${lastError.message}`
        : `Network error calling Gemini: ${lastError?.message || 'Unknown error'}`;
    throw new Error(errMsg);
}

function tryExtractJson(rawText) {
    const text = String(rawText || '').trim();
    const firstObj = text.indexOf('{');
    const firstArr = text.indexOf('[');
    let start = -1;
    if (firstObj === -1) start = firstArr;
    else if (firstArr === -1) start = firstObj;
    else start = Math.min(firstObj, firstArr);

    const lastObj = text.lastIndexOf('}');
    const lastArr = text.lastIndexOf(']');
    const end = Math.max(lastObj, lastArr);

    if (start < 0 || end <= start) return null;
    const slice = text.slice(start, end + 1);
    try {
        return JSON.parse(slice);
    } catch {
        return null;
    }
}

module.exports = { callGemini, getQuota, isQuotaSafe, incrementCacheHit, setBlocked, setSocketEmitter };
