/**
 * Product Trend Research Service V4.0.1
 */
const db = require('./db');
const { callGemini, incrementCacheHit, getQuota } = require('./gemini');
const crypto = require('crypto');

const DEFAULT_CATEGORIES = ['Skincare', 'Gia dụng', 'Fitness', 'Thời trang', 'Mẹ & bé', 'Điện tử', 'Sức khỏe', 'Thú cưng', 'Đồ chơi', 'Nhà cửa'];
const inFlight = new Map();

function withInFlight(key, fn) {
    if (inFlight.has(key)) return inFlight.get(key);
    const promise = fn().finally(() => inFlight.delete(key));
    inFlight.set(key, promise);
    return promise;
}

function shouldUseLite(quota) {
    return !!(quota && quota.request_count >= quota.soft_cap);
}

function extractList(data, preferredKeys = []) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    for (const key of preferredKeys) {
        if (Array.isArray(data[key])) return data[key];
    }
    const values = Object.values(data);
    const arrayValue = values.find(value => Array.isArray(value));
    return arrayValue || [];
}

function validateData(items, requiredFields) {
    if (!Array.isArray(items)) return [];
    return items.filter(item => {
        if (!item || typeof item !== 'object') return false;
        return requiredFields.every(field => item[field] !== undefined && item[field] !== null);
    });
}

function renderPrompt(template, variables = {}) {
    let output = template || '';
    Object.entries(variables).forEach(([key, value]) => {
        const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}}`, 'g');
        output = output.replace(pattern, String(value ?? ''));
    });
    return output;
}

async function getPromptText(pageType, variables = {}) {
    const r = await db.query(
        `SELECT prompt_text FROM research_prompts
         WHERE page_type = $1 AND is_active = TRUE
         ORDER BY updated_at DESC LIMIT 1`,
        [pageType]
    );
    const row = r.rows[0];
    if (!row?.prompt_text) throw new Error(`No active prompt configured for ${pageType}.`);
    return renderPrompt(row.prompt_text, variables);
}

// Server-side generated_at injection (patch #4: never trust AI timestamps)
function injectServerTimestamp(items) {
    const now = new Date().toISOString();
    if (Array.isArray(items)) {
        return items.map(item => ({ ...item, generated_at: now, schema_version: 'V4.0.1' }));
    }
    if (items && typeof items === 'object') {
        return { ...items, generated_at: now, schema_version: 'V4.0.1' };
    }
    return items;
}

function hash(text) {
    return crypto.createHash('md5').update(String(text || '')).digest('hex');
}

// ─── Trend Research API ──────────────────────────────────────────────

async function getProductTrends(options = {}) {
    const market = options.market || 'vn';
    const categories = options.categories || DEFAULT_CATEGORIES;
    const window = options.window || 'last_7_days';
    const limit = options.limit || 8;
    
    const categoriesStr = Array.isArray(categories) ? categories.join(',') : categories;
    const marketHash = hash(market);
    const categoryHash = hash(categoriesStr);
    const windowHash = hash(window);
    
    const cacheKey = `trends:${market}:${categoriesStr}:${window}`;
    return withInFlight(cacheKey, async () => {
        const prompt = await getPromptText('overview', {
            MARKET: market,
            LANGUAGE: 'Vietnamese',
            CATEGORIES: categoriesStr,
            SOURCE_WINDOW: window,
            LIMIT: limit,
            MODE: 'overview'
        });
        
        const quota = await getQuota();
        const useLite = options.useLite ?? shouldUseLite(quota);
        const modelVersion = useLite ? 'gemini-2.5-flash-lite' : 'gemini-2.5-flash';
        const promptHash = hash(prompt + modelVersion);
        const modelHash = hash(modelVersion);

        // Check cache
        const cacheRes = await db.query(
            `SELECT data, expires_at < NOW() as is_stale FROM cached_product_trends
             WHERE market_hash = $1 AND category_hash = $2 AND source_window_hash = $3
               AND prompt_hash = $4 AND model_hash = $5`,
            [marketHash, categoryHash, windowHash, promptHash, modelHash]
        );
        
        if (cacheRes.rows.length > 0) {
            const row = cacheRes.rows[0];
            if (!row.is_stale) {
                await incrementCacheHit();
                return { data: row.data, is_stale: false, schema_version: 'V4.0.1' };
            }
        }

        let aiData;
        try {
            aiData = await callGemini(prompt, { endpoint: 'product_trends', useLite });
        } catch (err) {
            console.warn('[Research] Trend AI error, fallback to DB:', err.message);
            const fallback = await getTrendsFromDB(market, categoriesStr);
            return { data: fallback, is_stale: true, schema_version: 'V4.0.1' };
        }
        
        const results = extractList(aiData, ['items', 'products', 'trends', 'data']);
        const validResults = validateData(results, ['id', 'category', 'product_name', 'trend_score', 'confidence_score', 'summary']);
        let bounded = validResults.filter(i => i.confidence_score >= 70).slice(0, limit);
        
        if (bounded.length > 0) {
            // Server-side timestamp and schema injection (Patch #4 & #7)
            bounded = injectServerTimestamp(bounded);

            // Store to cache
            await db.query(
                `INSERT INTO cached_product_trends (market_hash, category_hash, source_window_hash, prompt_hash, model_hash, data, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours')
                 ON CONFLICT (market_hash, category_hash, source_window_hash, prompt_hash, model_hash)
                 DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
                [marketHash, categoryHash, windowHash, promptHash, modelHash, JSON.stringify(bounded)]
            );
            
            // Store to main tables
            for (const item of bounded) {
                const summaryData = {
                    trend_score: item.trend_score,
                    confidence_score: item.confidence_score,
                    growth_signal: item.growth_signal,
                    summary: item.summary,
                    generated_at: item.generated_at,
                    schema_version: item.schema_version
                };
                await db.query(
                    `INSERT INTO product_trend_results (product_id, market, category, raw_data, summary_data, model_name, source_window, schema_version)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                     ON CONFLICT (product_id) DO UPDATE SET
                     raw_data = EXCLUDED.raw_data, summary_data = EXCLUDED.summary_data, schema_version = EXCLUDED.schema_version, created_at = NOW()`,
                    [item.id, market, item.category || 'Other', JSON.stringify(item), JSON.stringify(summaryData), modelVersion, window, item.schema_version]
                );
            }
            return { data: bounded, is_stale: false, schema_version: 'V4.0.1' };
        } else {
            // fallback if empty
            const fallback = await getTrendsFromDB(market, categoriesStr);
            return { data: fallback, is_stale: true, schema_version: 'V4.0.1' };
        }
    });
}

// ─── Deep Dive & Opportunity ──────────────────────────────────────────────

async function getProductDetail(productId, type = 'deep_dive') {
    // type can be 'deep_dive' or 'opportunity'
    const cacheKey = `${type}:${productId}`;
    return withInFlight(cacheKey, async () => {
        // Fetch product base info
        const prodRes = await db.query(`SELECT raw_data, category FROM product_trend_results WHERE product_id = $1`, [productId]);
        if (prodRes.rows.length === 0) return null;
        
        const baseProduct = prodRes.rows[0].raw_data;
        const category = prodRes.rows[0].category;

        // check if detail already in DB
        const detailRes = await db.query(`SELECT detail_data FROM product_trend_details WHERE product_id = $1 AND type = $2`, [productId, type]);
        if (detailRes.rows.length > 0) {
            return detailRes.rows[0].detail_data;
        }

        const promptTemplate = type === 'deep_dive' ? 'deep_dive' : 'opportunity';
        const prompt = await getPromptText(promptTemplate, {
            PRODUCT_ID: productId,
            PRODUCT_NAME: baseProduct.product_name,
            CATEGORY: category
        });

        const quota = await getQuota();
        const useLite = shouldUseLite(quota);
        let aiData;
        try {
            aiData = await callGemini(prompt, { endpoint: type, useLite });
        } catch (err) {
            console.error(`[Research] ${type} error:`, err.message);
            return null;
        }

        const results = extractList(aiData, ['items', 'data', 'recommendations']);
        // For deep_dive we expect 1 object, opportunity might return array
        let finalData = results.length > 0 ? results[0] : (Array.isArray(aiData) ? aiData[0] : aiData);

        if (finalData && typeof finalData === 'object') {
            // Server-side timestamp and schema injection (Patch #4 & #7)
            finalData = injectServerTimestamp(finalData);

            await db.query(
                `INSERT INTO product_trend_details (product_id, type, detail_data, schema_version)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (product_id, type) DO UPDATE SET detail_data = EXCLUDED.detail_data, schema_version = EXCLUDED.schema_version`,
                [productId, type, JSON.stringify(finalData), finalData.schema_version]
            );
            return finalData;
        }
        return null;
    });
}

async function runDailyTrendResearch() {
    console.log('[Research] Starting V4 daily trend research job...');
    await db.query(`UPDATE quota_state SET last_cron_run = NOW() WHERE id = 1`);
    try {
        const res = await getProductTrends({ market: 'vn', categories: DEFAULT_CATEGORIES, limit: 10 });
        console.log(`[Research] Fetched ${res.data.length} trends.`);
    } catch(err) {
        console.error('[Research] Daily job error:', err.message);
    }
}

async function getTrendsFromDB(market, categoriesStr) {
    const categories = categoriesStr.split(',').map(s => s.trim());
    const r = await db.query(
        `SELECT raw_data FROM product_trend_results WHERE market = $1 AND category = ANY($2) ORDER BY created_at DESC LIMIT 20`,
        [market, categories]
    );
    return r.rows.map(row => row.raw_data);
}

// ─── Export ────────────────────────────────────────────────────────────────

module.exports = {
    getProductTrends,
    getProductDetail,
    runDailyTrendResearch,
    SEED_TOPICS: DEFAULT_CATEGORIES
};
