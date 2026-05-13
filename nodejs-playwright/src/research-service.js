/**
 * Product Trend Research Service V4.0.1
 */
const db = require('./db');
const { callGemini, incrementCacheHit, getQuota } = require('./gemini');
const crypto = require('crypto');

const DEFAULT_CATEGORIES = ['Skincare', 'Gia dụng', 'Fitness', 'Thời trang', 'Mẹ & bé', 'Điện tử', 'Sức khỏe', 'Thú cưng', 'Đồ chơi', 'Nhà cửa'];
const inFlight = new Map();
const TREND_WINDOWS = {
    today: 'trong ngày hôm nay, ưu tiên tín hiệu mới nhất trong 24 giờ qua',
    last_3_days: 'trong 3 ngày gần nhất, ưu tiên tín hiệu tăng tốc ngắn hạn',
    last_7_days: 'trong 7 ngày gần nhất, ưu tiên xu hướng bền hơn trong tuần'
};

const LEGACY_PAGE_CONFIG = {
    mmo: {
        promptType: 'mmo',
        listKeys: ['items', 'opportunities', 'data', 'results'],
        required: ['title', 'category', 'trend_score', 'monetization_score', 'competition_score'],
        defaultTopics: ['affiliate TikTok Shop', 'digital product', 'AI automation service', 'print on demand', 'content niche'],
        limit: 12
    },
    ai_tools: {
        promptType: 'ai_tools',
        listKeys: ['items', 'tools', 'data', 'results'],
        required: ['tool_name', 'tool_type', 'use_case'],
        limit: 12
    },
    suggestions: {
        promptType: 'suggestions',
        listKeys: ['items', 'suggestions', 'recommendations', 'data', 'results'],
        required: ['recommendation_title'],
        limit: 10
    }
};

const BILINGUAL_OUTPUT_INSTRUCTION = `

YEU CAU DINH DANG NGON NGU BAT BUOC:
- Tat ca noi dung hien thi cho nguoi dung phai viet theo dang: tieng Viet (English).
- Vi du: "Chien luoc noi dung ngan (Short-form content strategy)".
- Ap dung cho title, summary, content_angle, traffic_source, monetization_model, use_case, market_signal, market_reason, best_value_reason, recommendation_title, recommendation_text, reasoning_summary, next_action.
- Khong dich ten rieng cua cong cu, san pham, thuong hieu.
`;

function normalizeTrendWindow(value) {
    if (value === 'last_24h' || value === '24h' || value === 'today') return 'today';
    if (value === '3_days' || value === 'last_3_days') return 'last_3_days';
    if (value === '7_days' || value === 'last_7_days') return 'last_7_days';
    return 'today';
}

function windowProductId(productId, window) {
    const base = String(productId || 'product').replace(/(__today|__last_3_days|__last_7_days)$/g, '');
    return `${base}__${window}`;
}

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

function score(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function slug(value, fallback) {
    return String(value || fallback || 'item')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 80) || fallback || 'item';
}

async function getLegacyPromptText(pageType, variables = {}) {
    const r = await db.query(
        `SELECT prompt_text FROM research_prompts
         WHERE page_type = $1 AND is_active = TRUE
         ORDER BY updated_at DESC LIMIT 1`,
        [pageType]
    );
    const row = r.rows[0];
    if (!row?.prompt_text) throw new Error(`No active prompt configured for ${pageType}.`);
    return renderPrompt(`${row.prompt_text}${BILINGUAL_OUTPUT_INSTRUCTION}`, variables);
}

async function getActiveTopics() {
    const r = await db.query(
        `SELECT name FROM research_topics
         WHERE is_active = TRUE
         ORDER BY created_at DESC
         LIMIT 12`
    );
    const topics = r.rows.map(row => row.name).filter(Boolean);
    return topics.length ? topics : LEGACY_PAGE_CONFIG.mmo.defaultTopics;
}

function normalizeMmoItem(item, index) {
    const title = item.title || item.name || item.opportunity || `MMO opportunity ${index + 1}`;
    return {
        id: item.id || slug(title, `mmo_${index + 1}`),
        title,
        category: item.category || item.niche || item.topic || 'General',
        trend_score: score(item.trend_score),
        monetization_score: score(item.monetization_score || item.money_score),
        competition_score: score(item.competition_score),
        content_angle: item.content_angle || item.angle || '',
        traffic_source: item.traffic_source || item.traffic || '',
        monetization_model: item.monetization_model || item.model || '',
        market_maturity: item.market_maturity || 'growing',
        confidence_score: score(item.confidence_score, 70),
        summary: item.summary || item.description || '',
        generated_at: new Date().toISOString(),
        source_window: item.source_window || 'last_7_days'
    };
}

function normalizeAiToolItem(item, index) {
    const toolName = item.tool_name || item.name || item.title || `AI tool ${index + 1}`;
    const valueScore = score(item.value_score || item.score, 70);
    const priceLevel = item.price_level || item.pricing_model || 'freemium';
    return {
        id: item.id || slug(toolName, `ai_tool_${index + 1}`),
        tool_name: toolName,
        tool_type: item.tool_type || item.type || 'other',
        use_case: item.use_case || item.primary_use_case || item.summary || '',
        value_score: valueScore,
        market_signal: item.market_signal || item.launch_status || item.status || '',
        market_reason: item.market_reason || item.reason || '',
        price_level: priceLevel,
        discount_or_launch_status: item.discount_or_launch_status || item.launch_status || item.status || priceLevel,
        confidence_score: score(item.confidence_score, 70),
        summary: item.summary || item.description || '',
        best_value_reason: item.best_value_reason || item.market_reason || item.reason || '',
        is_best_value: item.is_best_value ?? valueScore >= 85,
        is_new_noteworthy: item.is_new_noteworthy ?? ['emerging', 'new', 'launching'].includes(String(item.market_signal || item.status || '').toLowerCase()),
        generated_at: new Date().toISOString()
    };
}

function normalizeSuggestionItem(item, index) {
    const title = item.recommendation_title || item.title || `AI suggestion ${index + 1}`;
    const plan = Array.isArray(item.execution_plan) ? item.execution_plan.join('\n') : '';
    return {
        recommendation_title: title,
        recommendation_text: item.recommendation_text || item.hook || item.summary || plan,
        confidence_score: score(item.confidence_score, score(item.roi_score, 75)),
        urgency_score: score(item.urgency_score, 60),
        roi_score: score(item.roi_score, 70),
        reasoning_summary: item.reasoning_summary || item.risk || item.market_reason || '',
        next_action: item.next_action || (Array.isArray(item.execution_plan) ? item.execution_plan[0] : ''),
        topic: item.topic || item.target_topic || item.category || 'General',
        raw_data: { ...item, generated_at: new Date().toISOString() }
    };
}

async function loadLegacyPageRows(page) {
    if (page === 'suggestions') {
        const result = await db.query(`SELECT * FROM ai_suggestions ORDER BY created_at DESC`);
        return result.rows;
    }
    const result = await db.query(
        `SELECT * FROM research_results WHERE page_type = $1 ORDER BY created_at DESC`,
        [page]
    );
    return result.rows.map(row => ({ ...row, ...row.data }));
}

async function refreshLegacyResearchPage(page, options = {}) {
    const config = LEGACY_PAGE_CONFIG[page];
    if (!config) throw new Error(`Unsupported research page: ${page}.`);

    if (page === 'suggestions') {
        const [mmoRows, aiRows] = await Promise.all([
            loadLegacyPageRows('mmo'),
            loadLegacyPageRows('ai_tools')
        ]);
        if (mmoRows.length === 0) await refreshLegacyResearchPage('mmo', options);
        if (aiRows.length === 0) await refreshLegacyResearchPage('ai_tools', options);
    }

    const topics = await getActiveTopics();
    const variables = {
        TOPICS: topics.join(', '),
        PAGE1_DATA: JSON.stringify((await loadLegacyPageRows('mmo')).slice(0, 20)),
        PAGE2_DATA: JSON.stringify((await loadLegacyPageRows('ai_tools')).slice(0, 20)),
        SOURCE_WINDOW: options.source_window || 'last_7_days',
        LIMIT: config.limit
    };

    const prompt = await getLegacyPromptText(config.promptType, variables);
    const quota = await getQuota();
    const useLite = options.useLite ?? !!(quota && quota.request_count >= quota.soft_cap);
    const aiData = await callGemini(prompt, { endpoint: config.promptType, skipCache: true, useLite });
    const rawItems = extractList(aiData, config.listKeys).slice(0, config.limit);
    const validItems = validateData(rawItems, config.required);

    if (validItems.length === 0) {
        throw new Error(`Gemini returned no valid ${page} items. Check active prompt schema.`);
    }

    if (page === 'mmo') {
        const normalized = validItems.map(normalizeMmoItem);
        await db.query('DELETE FROM research_results WHERE page_type = $1', ['mmo']);
        for (const item of normalized) {
            await db.query(
                `INSERT INTO research_results
                 (topic, page_type, title, category, data, trend_score, monetization_score, competition_score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [item.category, 'mmo', item.title, item.category, JSON.stringify(item), item.trend_score, item.monetization_score, item.competition_score]
            );
        }
        return { page, count: normalized.length, data: normalized, use_lite: useLite };
    }

    if (page === 'ai_tools') {
        const normalized = validItems.map(normalizeAiToolItem);
        await db.query('DELETE FROM research_results WHERE page_type = $1', ['ai_tools']);
        for (const item of normalized) {
            await db.query(
                `INSERT INTO research_results
                 (topic, page_type, title, category, data, trend_score, monetization_score, competition_score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [item.tool_type, 'ai_tools', item.tool_name, item.tool_type, JSON.stringify(item), item.value_score, item.confidence_score, 0]
            );
        }
        return { page, count: normalized.length, data: normalized, use_lite: useLite };
    }

    const normalized = validItems.map(normalizeSuggestionItem);
    await db.query('DELETE FROM ai_suggestions');
    for (const item of normalized) {
        await db.query(
            `INSERT INTO ai_suggestions
             (recommendation_title, recommendation_text, confidence_score, urgency_score, roi_score, reasoning_summary, next_action, topic)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
            [item.recommendation_title, item.recommendation_text, item.confidence_score, item.urgency_score, item.roi_score, item.reasoning_summary, item.next_action, item.topic]
        );
    }
    return { page, count: normalized.length, data: normalized, use_lite: useLite };
}

// ─── Trend Research API ──────────────────────────────────────────────

async function getProductTrends(options = {}) {
    const market = options.market || 'vn';
    const categories = options.categories || DEFAULT_CATEGORIES;
    const window = normalizeTrendWindow(options.window || 'today');
    const limit = options.limit || 8;
    const forceFresh = !!(options.forceFresh || options.skipCache);
    
    const categoriesStr = Array.isArray(categories) ? categories.join(',') : categories;
    const marketHash = hash(market);
    const categoryHash = hash(categoriesStr);
    const windowHash = hash(window);
    
    const cacheKey = `trends:${market}:${categoriesStr}:${window}`;
    return withInFlight(cacheKey, async () => {
        let prompt = await getPromptText('overview', {
            MARKET: market,
            LANGUAGE: 'Vietnamese',
            CATEGORIES: categoriesStr,
            SOURCE_WINDOW: window,
            WINDOW_DESCRIPTION: TREND_WINDOWS[window],
            CURRENT_DATE: new Date().toISOString().slice(0, 10),
            LIMIT: limit,
            MODE: 'overview'
        });
        prompt += `

SOURCE WINDOW REQUIREMENT:
- source_window must be exactly "${window}".
- Current date is ${new Date().toISOString().slice(0, 10)}.
- Analyze ${TREND_WINDOWS[window]}.
- For "today", prioritize products with same-day spikes, newly viral posts, marketplace rank jumps, or search/social acceleration today.
- For "last_3_days", prioritize products with acceleration in the last 72 hours.
- For "last_7_days", prioritize products with reliable weekly momentum.
- Do not reuse stale generic evergreen products unless they have a clear signal inside this source window.`;
        
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
        
        if (!forceFresh && cacheRes.rows.length > 0) {
            const row = cacheRes.rows[0];
            if (!row.is_stale) {
                await incrementCacheHit();
                return { data: row.data, is_stale: false, schema_version: 'V4.0.1' };
            }
        }

        let aiData;
        try {
            aiData = await callGemini(prompt, { endpoint: 'product_trends', skipCache: forceFresh, useLite });
        } catch (err) {
            console.warn('[Research] Trend AI error, fallback to DB:', err ? err.message : 'Unknown error');
            const fallback = await getTrendsFromDB(market, categoriesStr, window);
            return { data: fallback, is_stale: true, schema_version: 'V4.0.1' };
        }

        
        const results = extractList(aiData, ['items', 'products', 'trends', 'data']);
        const validResults = validateData(results, ['id', 'category', 'product_name', 'trend_score', 'confidence_score', 'summary']);
        let bounded = validResults.filter(i => i.confidence_score >= 70).slice(0, limit);
        
        if (bounded.length > 0) {
            // Server-side timestamp and schema injection (Patch #4 & #7)
            bounded = bounded.map(item => ({
                ...item,
                canonical_id: item.id,
                id: windowProductId(item.id, window),
                source_window: window
            }));
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
            const fallback = await getTrendsFromDB(market, categoriesStr, window);
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
    const summary = {
        trends: {},
        legacy: {},
        errors: []
    };
    const windows = ['today', 'last_3_days', 'last_7_days'];
    for (const sourceWindow of windows) {
        try {
            const res = await getProductTrends({
                market: 'vn',
                categories: DEFAULT_CATEGORIES,
                window: sourceWindow,
                limit: 10,
                forceFresh: true
            });
            console.log(`[Research] Fetched ${res.data.length} ${sourceWindow} trends.`);
            summary.trends[sourceWindow] = res.data.length;
        } catch (err) {
            console.error(`[Research] ${sourceWindow} trends error:`, err.message);
            summary.errors.push({ page: `trends:${sourceWindow}`, error: err.message });
        }
    }

    const legacyPages = ['mmo', 'ai_tools', 'suggestions'];
    for (const page of legacyPages) {
        try {
            const res = await refreshLegacyResearchPage(page, { source_window: 'last_7_days' });
            console.log(`[Research] Refreshed ${res.count} ${page} legacy items.`);
            summary.legacy[page] = res.count;
        } catch (err) {
            console.error(`[Research] ${page} legacy error:`, err.message);
            summary.errors.push({ page, error: err.message });
        }
    }
    if (summary.errors.length) console.error(`[Research] Daily job completed with ${summary.errors.length} errors.`);
    return summary;
}

async function getTrendsFromDB(market, categoriesStr, window = 'today') {
    const categories = categoriesStr.split(',').map(s => s.trim());
    const r = await db.query(
        `SELECT raw_data
         FROM product_trend_results
         WHERE market = $1 AND category = ANY($2) AND source_window = $3
         ORDER BY created_at DESC
         LIMIT 20`,
        [market, categories, normalizeTrendWindow(window)]
    );
    return r.rows.map(row => row.raw_data);
}

// ─── Export ────────────────────────────────────────────────────────────────

module.exports = {
    getProductTrends,
    getProductDetail,
    refreshLegacyResearchPage,
    runDailyTrendResearch,
    SEED_TOPICS: DEFAULT_CATEGORIES
};
