/**
 * Product Trend API Routes V4.0.1
 * Mounted at /api/product-trends
 */
const express = require('express');
const router = express.Router();
const db = require('./db');
const { getProductTrends, getProductDetail, runDailyTrendResearch } = require('./research-service');
const { callGemini, getQuota } = require('./gemini');
const RESEARCH_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Ho_Chi_Minh';

function localDateSql(column = 'created_at') {
    return `DATE(${column} AT TIME ZONE '${RESEARCH_TIMEZONE}')`;
}

function localDateKeySql(column = 'created_at') {
    return `TO_CHAR(${localDateSql(column)}, 'YYYY-MM-DD')`;
}

function currentLocalDate() {
    const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: RESEARCH_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).formatToParts(new Date());
    const get = type => parts.find(part => part.type === type)?.value;
    return `${get('year')}-${get('month')}-${get('day')}`;
}

function normalizeWindow(value = 'today') {
    const map = {
        '3d': 'last_3_days',
        '7d': 'last_7_days',
        'last3': 'last_3_days',
        'last7': 'last_7_days',
        'last_3_days': 'last_3_days',
        'last_7_days': 'last_7_days',
        today: 'today'
    };
    return map[String(value || 'today')] || String(value || 'today');
}

function parseCategories(value) {
    if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean);
    const raw = String(value || '').trim();
    if (!raw || raw.toLowerCase() === 'all') return ['all'];
    return raw.split(',').map(c => c.trim()).filter(Boolean);
}

function isAllCategories(categories = []) {
    return !categories.length || categories.some(c => String(c).toLowerCase() === 'all');
}

function buildDateMeta({ page, requestedDate, resolvedDate, availableDates = [], rowCount = 0, extra = {} }) {
    const emptyReason = rowCount === 0
        ? (requestedDate
            ? `No ${page} data for ${requestedDate}.`
            : `No ${page} data available.`)
        : null;
    return {
        page,
        date_mode: requestedDate ? 'selected' : 'latest_available',
        requested_date: requestedDate || null,
        resolved_date: resolvedDate || requestedDate || null,
        available_dates: availableDates,
        row_count: rowCount,
        empty_reason: emptyReason,
        ...extra
    };
}

const LEGACY_PAGE_CONFIG = {
    mmo: {
        promptType: 'mmo',
        table: 'research_results',
        listKeys: ['items', 'opportunities', 'data', 'results'],
        required: ['title', 'category', 'trend_score', 'monetization_score', 'competition_score'],
        defaultTopics: ['affiliate TikTok Shop', 'digital product', 'AI automation service', 'print on demand', 'content niche'],
        limit: 12
    },
    ai_tools: {
        promptType: 'ai_tools',
        table: 'research_results',
        listKeys: ['items', 'tools', 'data', 'results'],
        required: ['tool_name', 'tool_type', 'use_case'],
        limit: 12
    },
    suggestions: {
        promptType: 'suggestions',
        table: 'ai_suggestions',
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

const AFF_VIDEO_PROMPT_FALLBACK = `You are AFF VID Planner for Vietnamese short-form affiliate content.
Return valid JSON only. No markdown. No explanation.

TASK:
Create one actionable affiliate video plan from the supplied research product. Do not invent a new product.

QUALITY RULES:
- Vietnamese first. Keep wording direct, specific, and easy to record.
- Hook must be under 18 Vietnamese words and name the pain, result, or curiosity gap.
- Script must be 4-7 short lines for a 20-45 second vertical video.
- Shot list must contain 4-7 shots with visual, on_screen_text, duration_seconds, and note.
- CTA must be platform-safe and conversion oriented.
- Hashtags must be 6-12 items, no spaces.
- priority_score = round((trend_score * 0.45) + (confidence_score * 0.35) + viral_fit_score * 0.20).
- If input is missing, fill from product summary/category and list missing fields in missing_fields.

REQUIRED JSON SHAPE:
{
  "product_id":"{{PRODUCT_ID}}",
  "product_name":"{{PRODUCT_NAME}}",
  "niche":"{{NICHE}}",
  "angle":"string",
  "hook":"string",
  "script":["line 1","line 2","line 3","line 4"],
  "shot_list":[{"shot":1,"visual":"string","on_screen_text":"string","duration_seconds":3,"note":"string"}],
  "CTA":"string",
  "caption":"string",
  "hashtags":["#tag"],
  "platform_targets":["TikTok","Facebook Reels","Instagram Reels"],
  "confidence_score":0,
  "priority_score":0,
  "viral_fit_score":0,
  "source_research":{"trend_score":0,"confidence_score":0,"growth_signal":"string","source_window":"string"},
  "missing_fields":[],
  "fallback_notes":[]
}

INPUT PRODUCT JSON:
{{PRODUCT_JSON}}

REQUESTED PLATFORMS:
{{PLATFORM_TARGETS}}

VIDEO OPTIONS:
{{VIDEO_OPTIONS}}`;

const UP_POST_PROMPT_FALLBACK = `You are UP POST Planner for Vietnamese social publishing.
Return valid JSON only. No markdown. No explanation.

TASK:
Convert the supplied source content into platform-specific post variants. Do not use one generic post for all platforms.

PLATFORM RULES:
- Threads: short, curious, conversational, 1-3 compact paragraphs.
- Facebook: clear context, useful explanation, CTA, can be longer.
- TikTok caption: strong hook, fast rhythm, action-focused, concise.
- Facebook video post: video-aware body, mention what viewers will see, CTA.

VALID PLATFORMS:
threads, facebook, tiktok_caption, facebook_video

REQUIRED JSON SHAPE:
{
  "source_content_id":"{{SOURCE_CONTENT_ID}}",
  "warnings":["string"],
  "posts":[
    {
      "post_id":"deterministic_slug",
      "source_content_id":"{{SOURCE_CONTENT_ID}}",
      "platform":"threads|facebook|tiktok_caption|facebook_video",
      "title":"string",
      "body":"string",
      "hook":"string",
      "CTA":"string",
      "hashtags":["#tag"],
      "post_type":"text|caption|video_post",
      "scheduled_time":null,
      "confidence_score":0,
      "platform_fit_score":0,
      "validation_warnings":["string"]
    }
  ]
}

QUALITY RULES:
- Vietnamese first.
- Each platform must have a distinct angle and wording.
- If source content is weak, add warnings and still create conservative drafts.
- Do not invent price, discount, guarantee, review, or availability.
- Hashtags 3-10 items, each starts with #.
- scheduled_time must be null unless explicitly provided.

INPUT SOURCE JSON:
{{SOURCE_JSON}}

PLATFORMS:
{{PLATFORMS}}

POST OPTIONS:
{{POST_OPTIONS}}`;

const UP_POST_PLATFORMS = ['threads', 'facebook', 'tiktok_caption', 'facebook_video'];

function renderPrompt(template, variables = {}) {
    return Object.entries(variables).reduce((output, [key, value]) => {
        const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}}`, 'g');
        return output.replace(pattern, String(value ?? ''));
    }, template || '');
}

async function getPromptTextOrFallback(pageType, fallback, variables = {}) {
    try {
        return await getPromptText(pageType, variables);
    } catch (err) {
        return renderPrompt(fallback, variables);
    }
}

function extractList(data, preferredKeys = []) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== 'object') return [];
    if (typeof data.raw === 'string') {
        try {
            return extractList(JSON.parse(data.raw), preferredKeys);
        } catch (err) {
            return [];
        }
    }
    for (const key of preferredKeys) {
        if (Array.isArray(data[key])) return data[key];
    }
    return Object.values(data).find(value => Array.isArray(value)) || [];
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

async function getPromptText(pageType, variables = {}) {
    const r = await db.query(
        `SELECT prompt_text FROM research_prompts
         WHERE page_type = $1 AND is_active = TRUE
         ORDER BY updated_at DESC LIMIT 1`,
        [pageType]
    );
    if (!r.rows[0]?.prompt_text) throw new Error(`No active prompt configured for ${pageType}.`);
    return renderPrompt(`${r.rows[0].prompt_text}${BILINGUAL_OUTPUT_INSTRUCTION}`, variables);
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

function validateItems(items, required) {
    return items.filter(item =>
        item && typeof item === 'object' && required.every(field => item[field] !== undefined && item[field] !== null && item[field] !== '')
    );
}

async function getLegacyAvailableDates(page) {
    if (page === 'suggestions') {
        const result = await db.query(`
            SELECT ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
            FROM ai_suggestions
            GROUP BY day
            ORDER BY day DESC
        `);
        return result.rows;
    }
    const result = await db.query(`
        SELECT ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
        FROM research_results
        WHERE page_type = $1
        GROUP BY day
        ORDER BY day DESC
    `, [page]);
    return result.rows;
}

async function resolveLegacyDate(page, requestedDate = null) {
    const dates = await getLegacyAvailableDates(page);
    return {
        requestedDate: requestedDate || null,
        resolvedDate: requestedDate || dates[0]?.day || null,
        availableDates: dates.map(row => row.day),
        countsByDate: dates
    };
}

async function loadLegacyPageRows(page, date = null) {
    const params = [];
    const where = [];
    if (date) {
        params.push(date);
        where.push(`${localDateSql('created_at')} = $${params.length}`);
    }
    const dateWhere = where.length ? ` AND ${where.join(' AND ')}` : '';
    if (page === 'suggestions') {
        const result = await db.query(`SELECT * FROM ai_suggestions WHERE 1=1${dateWhere} ORDER BY created_at DESC`, params);
        return result.rows;
    }
    params.unshift(page);
    const adjustedDateWhere = where.length ? ` AND ${where.map((clause, idx) => clause.replace(`$${idx + 1}`, `$${idx + 2}`)).join(' AND ')}` : '';
    const result = await db.query(`SELECT * FROM research_results WHERE page_type = $1${adjustedDateWhere} ORDER BY created_at DESC`, params);
    return result.rows.map(r => ({ ...r, ...r.data }));
}

async function getProductTrendAvailableDates({ market = 'vn', categories = ['all'], window = 'today' } = {}) {
    const params = [market, normalizeWindow(window)];
    const where = ['market = $1', 'source_window = $2'];
    if (!isAllCategories(categories)) {
        params.push(categories);
        where.push(`category = ANY($${params.length})`);
    }
    const result = await db.query(`
        SELECT ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
        FROM product_trend_results
        WHERE ${where.join(' AND ')}
        GROUP BY day
        ORDER BY day DESC
    `, params);
    return result.rows;
}

async function resolveProductTrendDate({ requestedDate = null, market = 'vn', categories = ['all'], window = 'today' } = {}) {
    const dates = await getProductTrendAvailableDates({ market, categories, window });
    return {
        requestedDate: requestedDate || null,
        resolvedDate: requestedDate || dates[0]?.day || null,
        availableDates: dates.map(row => row.day),
        countsByDate: dates
    };
}

async function loadProductTrendRows({ market, categories, window, limit, date }) {
    const normalizedWindow = normalizeWindow(window);
    const normalizedCategories = parseCategories(categories);
    const params = [market, normalizedWindow];
    const where = ['market = $1', 'source_window = $2'];
    if (!isAllCategories(normalizedCategories)) {
        params.push(normalizedCategories);
        where.push(`category = ANY($${params.length})`);
    }
    if (date) {
        params.push(date);
        where.push(`${localDateSql('created_at')} = $${params.length}`);
    }
    params.push(limit);
    const result = await db.query(`
        SELECT raw_data
        FROM product_trend_results
        WHERE ${where.join(' AND ')}
        ORDER BY created_at DESC
        LIMIT $${params.length}
    `, params);
    return result.rows.map(row => row.raw_data);
}

async function ensureAffVideoTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS aff_video_plans (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id TEXT NOT NULL REFERENCES product_trend_results(product_id) ON DELETE CASCADE,
            plan_data JSONB NOT NULL,
            status TEXT DEFAULT 'draft',
            platform_targets TEXT[] DEFAULT ARRAY[]::TEXT[],
            source_window TEXT,
            schema_version TEXT DEFAULT 'AFF_VID_V1',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_aff_video_plans_product_created
        ON aff_video_plans(product_id, created_at DESC)
    `);
}

async function ensureUpPostTables() {
    await ensureAffVideoTable();
    await db.query(`
        CREATE TABLE IF NOT EXISTS up_post_variants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            post_id TEXT UNIQUE NOT NULL,
            source_content_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            platform TEXT NOT NULL,
            post_data JSONB NOT NULL,
            status TEXT DEFAULT 'draft',
            queue_payload JSONB,
            scheduled_time TIMESTAMP,
            schema_version TEXT DEFAULT 'UP_POST_V1',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_up_post_variants_source
        ON up_post_variants(source_content_id, platform)
    `);
    await db.query(`
        CREATE INDEX IF NOT EXISTS idx_up_post_variants_status
        ON up_post_variants(status, scheduled_time)
    `);
}

function normalizeAffVideoCandidate(row) {
    const product = row.raw_data || {};
    const trendScore = score(product.trend_score || row.summary_data?.trend_score, 0);
    const confidenceScore = score(product.confidence_score || row.summary_data?.confidence_score, 0);
    const priorityScore = score(Math.round((trendScore * 0.55) + (confidenceScore * 0.45)), 0);
    return {
        product_id: row.product_id,
        product_name: product.product_name || product.name || row.product_id,
        niche: product.category || row.category || 'General',
        angle_seed: product.summary || product.search_intent || product.target_audience || '',
        trend_score: trendScore,
        confidence_score: confidenceScore,
        priority_score: priorityScore,
        growth_signal: product.growth_signal || row.summary_data?.growth_signal || '',
        source_window: row.source_window || product.source_window || 'today',
        market: row.market,
        created_at: row.created_at
    };
}

async function loadAffVideoCandidates({ date, market = 'vn', window = 'today', categories = ['all'], limit = 12 }) {
    const normalizedWindow = normalizeWindow(window);
    const normalizedCategories = parseCategories(categories);
    const params = [market, normalizedWindow];
    const where = ['market = $1', 'source_window = $2'];
    if (!isAllCategories(normalizedCategories)) {
        params.push(normalizedCategories);
        where.push(`category = ANY($${params.length})`);
    }
    if (date) {
        params.push(date);
        where.push(`${localDateSql('created_at')} = $${params.length}`);
    }
    params.push(limit);
    const limitParam = params.length;
    const result = await db.query(`
        SELECT product_id, market, category, raw_data, summary_data, source_window, created_at
        FROM product_trend_results
        WHERE ${where.join(' AND ')}
        ORDER BY
            COALESCE((raw_data->>'trend_score')::INT, 0) DESC,
            COALESCE((raw_data->>'confidence_score')::INT, 0) DESC,
            created_at DESC
        LIMIT $${limitParam}
    `, params);
    return result.rows.map(normalizeAffVideoCandidate);
}

function normalizeAffVideoPlan(plan, product, requestedPlatforms = [], options = {}) {
    const missing = [];
    if (!product.product_name) missing.push('product_name');
    if (!product.category) missing.push('niche/category');
    if (!product.summary) missing.push('summary');
    const platformTargets = requestedPlatforms.length
        ? requestedPlatforms
        : (Array.isArray(plan.platform_targets) && plan.platform_targets.length ? plan.platform_targets : ['TikTok', 'Facebook Reels', 'Instagram Reels']);
    const trendScore = score(product.trend_score, 60);
    const confidenceScore = score(plan.confidence_score || product.confidence_score, 70);
    const viralFitScore = score(plan.viral_fit_score, Math.round((trendScore + confidenceScore) / 2));
    const priorityScore = score(plan.priority_score, Math.round((trendScore * 0.45) + (confidenceScore * 0.35) + (viralFitScore * 0.20)));
    return {
        product_id: product.id,
        product_name: product.product_name || product.name || product.id,
        niche: plan.niche || product.category || 'General',
        angle: plan.angle || product.summary || product.search_intent || 'Góc review nhanh dựa trên tín hiệu research',
        hook: plan.hook || `Sản phẩm ${product.product_name || product.id} có gì đáng thử?`,
        script: Array.isArray(plan.script) && plan.script.length ? plan.script : [
            `Mở đầu bằng vấn đề của người mua trong ngách ${product.category || 'này'}.`,
            `Giới thiệu ${product.product_name || product.id} và lý do đang có tín hiệu tăng.`,
            'Nêu 2 lợi ích thực tế, dễ nhìn thấy khi quay video ngắn.',
            'Kết bằng lời kêu gọi xem link hoặc bình luận để nhận gợi ý.'
        ],
        shot_list: Array.isArray(plan.shot_list) && plan.shot_list.length ? plan.shot_list : [
            { shot: 1, visual: 'Cận cảnh sản phẩm hoặc ảnh marketplace', on_screen_text: plan.hook || 'Đang được chú ý', duration_seconds: 3, note: 'Mở bằng chuyển động nhanh' },
            { shot: 2, visual: 'Demo vấn đề trước khi dùng', on_screen_text: 'Vấn đề thường gặp', duration_seconds: 5, note: 'Dùng cảnh đời thường' },
            { shot: 3, visual: 'Demo sản phẩm giải quyết vấn đề', on_screen_text: 'Cách xử lý nhanh', duration_seconds: 8, note: 'Quay rõ thao tác' },
            { shot: 4, visual: 'Kết quả sau khi dùng', on_screen_text: 'Có đáng mua?', duration_seconds: 5, note: 'Đưa nhận xét ngắn' }
        ],
        CTA: plan.CTA || plan.cta || 'Xem link sản phẩm và so sánh giá trước khi mua.',
        caption: plan.caption || `${product.product_name || product.id} đang có tín hiệu tốt trong ngách ${product.category || 'affiliate'}.`,
        hashtags: Array.isArray(plan.hashtags) && plan.hashtags.length ? plan.hashtags : ['#reviewsanpham', '#tiktokshop', '#muasamthongminh', '#affiliate'],
        platform_targets: platformTargets,
        video_setup: {
            video_duration: options.video_duration || plan.video_duration || '30-45s',
            tone: options.tone || plan.tone || 'review thực tế',
            cta_type: options.cta_type || plan.cta_type || 'affiliate_click',
            creator_persona: options.creator_persona || plan.creator_persona || 'reviewer tiếng Việt',
            affiliate_url: options.affiliate_url || null,
            language: options.language || 'vi'
        },
        confidence_score: confidenceScore,
        priority_score: priorityScore,
        viral_fit_score: viralFitScore,
        source_research: {
            trend_score: trendScore,
            confidence_score: score(product.confidence_score, confidenceScore),
            growth_signal: product.growth_signal || '',
            source_window: product.source_window || 'today'
        },
        missing_fields: [...new Set([...(Array.isArray(plan.missing_fields) ? plan.missing_fields : []), ...missing])],
        fallback_notes: Array.isArray(plan.fallback_notes) ? plan.fallback_notes : []
    };
}

function extractObject(data) {
    if (Array.isArray(data)) return data[0] || {};
    if (!data || typeof data !== 'object') return {};
    if (data.data && typeof data.data === 'object') return extractObject(data.data);
    if (Array.isArray(data.items)) return data.items[0] || {};
    return data;
}

async function generateAffVideoPlan(productId, platformTargets = [], options = {}) {
    await ensureAffVideoTable();
    const productRes = await db.query(`
        SELECT product_id, market, category, raw_data, summary_data, source_window
        FROM product_trend_results
        WHERE product_id = $1
    `, [productId]);
    if (productRes.rows.length === 0) {
        const err = new Error('Product not found in AI Research results.');
        err.status = 404;
        throw err;
    }
    const row = productRes.rows[0];
    const product = {
        ...(row.raw_data || {}),
        id: row.product_id,
        category: row.raw_data?.category || row.category,
        source_window: row.source_window
    };
    const prompt = await getPromptTextOrFallback('aff_vid', AFF_VIDEO_PROMPT_FALLBACK, {
        PRODUCT_ID: row.product_id,
        PRODUCT_NAME: product.product_name || row.product_id,
        NICHE: product.category || row.category || 'General',
        PRODUCT_JSON: JSON.stringify(product),
        PLATFORM_TARGETS: JSON.stringify(platformTargets.length ? platformTargets : ['TikTok', 'Facebook Reels', 'Instagram Reels']),
        VIDEO_OPTIONS: JSON.stringify({
            video_duration: options.video_duration || '30-45s',
            tone: options.tone || 'review thực tế',
            cta_type: options.cta_type || 'affiliate_click',
            creator_persona: options.creator_persona || 'reviewer tiếng Việt',
            affiliate_url: options.affiliate_url || null,
            language: options.language || 'vi'
        })
    });

    let aiPlan = {};
    let fallbackNotes = [];
    try {
        aiPlan = extractObject(await callGemini(prompt, { endpoint: 'aff_vid', skipCache: true }));
    } catch (err) {
        fallbackNotes = [`Gemini error: ${err.message}`];
    }
    const normalized = normalizeAffVideoPlan({ ...aiPlan, fallback_notes: fallbackNotes }, product, platformTargets, options);
    await db.query(`
        INSERT INTO aff_video_plans (product_id, plan_data, platform_targets, source_window, schema_version, updated_at)
        VALUES ($1, $2, $3, $4, 'AFF_VID_V1', NOW())
    `, [row.product_id, JSON.stringify(normalized), normalized.platform_targets, row.source_window]);
    return normalized;
}

async function loadUpPostSources({ limit = 20, sourceType = 'aff_vid', date = null } = {}) {
    await ensureUpPostTables();
    const dateParams = [];
    const dateWhere = [];
    if (date) {
        dateParams.push(date);
        dateWhere.push(`${localDateSql('created_at')} = $${dateParams.length}`);
    }
    if (sourceType === 'research') {
        const params = [...dateParams, limit];
        const result = await db.query(`
            SELECT product_id as id, 'research' as source_type, raw_data as content, created_at
            FROM product_trend_results
            ${dateWhere.length ? `WHERE ${dateWhere.join(' AND ')}` : ''}
            ORDER BY created_at DESC
            LIMIT $${params.length}
        `, params);
        return result.rows.map(row => ({
            source_content_id: row.id,
            source_type: row.source_type,
            title: row.content?.product_name || row.id,
            summary: row.content?.summary || row.content?.search_intent || '',
            platforms: ['threads', 'facebook', 'tiktok_caption', 'facebook_video'],
            created_at: row.created_at
        }));
    }
    const params = [...dateParams, limit];
    const result = await db.query(`
        SELECT id, product_id, plan_data, platform_targets, status, created_at
        FROM aff_video_plans
        ${dateWhere.length ? `WHERE ${dateWhere.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT $${params.length}
    `, params);
    return result.rows.map(row => ({
        source_content_id: String(row.id),
        source_type: 'aff_vid',
        product_id: row.product_id,
        title: row.plan_data?.product_name || row.product_id,
        summary: row.plan_data?.hook || row.plan_data?.angle || row.plan_data?.caption || '',
        platforms: ['threads', 'facebook', 'tiktok_caption', 'facebook_video'],
        status: row.status,
        created_at: row.created_at
    }));
}

async function getUpPostAvailableDates(sourceType = 'aff_vid') {
    await ensureUpPostTables();
    const table = sourceType === 'research' ? 'product_trend_results' : 'aff_video_plans';
    const result = await db.query(`
        SELECT ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
        FROM ${table}
        GROUP BY day
        ORDER BY day DESC
    `);
    return result.rows;
}

async function getUpPostSource(sourceContentId, sourceType = 'aff_vid') {
    await ensureUpPostTables();
    if (sourceType === 'research') {
        const result = await db.query(`
            SELECT product_id, raw_data, category, source_window, created_at
            FROM product_trend_results
            WHERE product_id = $1
        `, [sourceContentId]);
        if (!result.rows.length) return null;
        const row = result.rows[0];
        return {
            source_content_id: row.product_id,
            source_type: 'research',
            content: {
                ...(row.raw_data || {}),
                product_id: row.product_id,
                niche: row.raw_data?.category || row.category,
                source_window: row.source_window
            }
        };
    }
    const result = await db.query(`
        SELECT id, product_id, plan_data, platform_targets, created_at
        FROM aff_video_plans
        WHERE id::TEXT = $1
    `, [sourceContentId]);
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
        source_content_id: String(row.id),
        source_type: 'aff_vid',
        content: {
            ...row.plan_data,
            aff_video_plan_id: String(row.id),
            product_id: row.product_id
        }
    };
}

function platformPostType(platform) {
    if (platform === 'tiktok_caption') return 'caption';
    if (platform === 'facebook_video') return 'video_post';
    return 'text';
}

function normalizePostVariant(post, source, platform, index, scheduledTime = null, options = {}) {
    const content = source.content || {};
    const sourceId = source.source_content_id;
    const baseTitle = content.product_name || content.title || content.hook || sourceId;
    const warnings = [];
    if (!content.hook && !content.caption && !content.summary) warnings.push('Source content lacks hook/caption/summary.');
    if (!content.CTA && !content.cta) warnings.push('Source content lacks CTA.');
    const postId = post.post_id || slug(`${sourceId}_${platform}_${index + 1}`, `up_post_${index + 1}`);
    const body = post.body || content.caption || content.angle || content.summary || `Bản nháp cho ${baseTitle}.`;
    const hook = post.hook || content.hook || String(body).split(/[.!?]/)[0] || baseTitle;
    const cta = post.CTA || post.cta || content.CTA || content.cta || 'Xem thêm thông tin trước khi quyết định.';
    const hashtags = Array.isArray(post.hashtags) && post.hashtags.length
        ? post.hashtags
        : (Array.isArray(content.hashtags) && content.hashtags.length ? content.hashtags.slice(0, 8) : ['#review', '#affiliate', '#muasamthongminh']);
    return {
        post_id: postId,
        source_content_id: sourceId,
        platform,
        title: post.title || baseTitle,
        body,
        hook,
        CTA: cta,
        hashtags: hashtags.map(tag => String(tag).startsWith('#') ? String(tag) : `#${String(tag).replace(/\s+/g, '')}`).slice(0, 10),
        post_type: post.post_type || platformPostType(platform),
        scheduled_time: post.scheduled_time || scheduledTime || null,
        post_setup: {
            campaign_tag: options.campaign_tag || null,
            tone: options.tone || 'rõ ràng, có CTA',
            cta_type: options.cta_type || 'engagement_or_click',
            requested_post_type: options.post_type || null
        },
        confidence_score: score(post.confidence_score, content.confidence_score || 70),
        platform_fit_score: score(post.platform_fit_score, 70),
        validation_warnings: [...new Set([...(Array.isArray(post.validation_warnings) ? post.validation_warnings : []), ...warnings])]
    };
}

function platformSpecificBody(post, sourceContent) {
    const productName = sourceContent.product_name || sourceContent.title || 'sản phẩm này';
    const hook = post.hook || sourceContent.hook || productName;
    const cta = post.CTA || sourceContent.CTA || 'Xem thêm trước khi quyết định.';
    if (post.platform === 'threads') {
        return `${hook}\n\n${productName} đang đáng chú ý vì giải quyết đúng một nhu cầu rất cụ thể. Bạn có muốn mình tách checklist nên mua/không nên mua không?`;
    }
    if (post.platform === 'facebook') {
        return `${hook}\n\nNếu bạn đang tìm một lựa chọn thực tế trong nhóm ${post.title || productName}, điểm đáng xem là: vấn đề nó giải quyết, cách dùng trong đời sống hằng ngày, và liệu có phù hợp nhu cầu của bạn không.\n\n${cta}`;
    }
    if (post.platform === 'tiktok_caption') {
        return `${hook} Xem nhanh trước khi mua. ${cta}`;
    }
    if (post.platform === 'facebook_video') {
        return `${hook}\n\nTrong video này mình sẽ đi từ vấn đề, cách sản phẩm xử lý, đến điểm cần cân nhắc trước khi mua.\n\n${cta}`;
    }
    return post.body;
}

function enforceDistinctPlatformPosts(posts, sourceContent) {
    const seen = new Map();
    return posts.map(post => {
        const key = String(post.body || '').trim().toLowerCase();
        if (!key || !seen.has(key)) {
            if (key) seen.set(key, post.platform);
            return post;
        }
        return {
            ...post,
            body: platformSpecificBody(post, sourceContent),
            validation_warnings: [
                ...(post.validation_warnings || []),
                `Body duplicated with ${seen.get(key)}; backend applied ${post.platform} framing.`
            ]
        };
    });
}

function normalizeUpPostResponse(aiData, source, platforms, scheduledTime = null, options = {}) {
    const obj = extractObject(aiData);
    const rawPosts = Array.isArray(obj.posts) ? obj.posts : (Array.isArray(aiData) ? aiData : []);
    const postsByPlatform = new Map(rawPosts.map(post => [post.platform, post]));
    let posts = platforms.map((platform, index) =>
        normalizePostVariant(postsByPlatform.get(platform) || {}, source, platform, index, scheduledTime, options)
    );
    posts = enforceDistinctPlatformPosts(posts, source.content || {});
    const warnings = Array.isArray(obj.warnings) ? obj.warnings : [];
    posts.forEach(post => warnings.push(...(post.validation_warnings || [])));
    return {
        source_content_id: source.source_content_id,
        source_type: source.source_type,
        warnings: [...new Set(warnings)],
        posts
    };
}

async function generateUpPosts({ sourceContentId, sourceType = 'aff_vid', platforms = UP_POST_PLATFORMS, scheduledTime = null, options = {} }) {
    await ensureUpPostTables();
    const source = await getUpPostSource(sourceContentId, sourceType);
    if (!source) {
        const err = new Error('Source content not found.');
        err.status = 404;
        throw err;
    }
    const cleanPlatforms = platforms.filter(platform => UP_POST_PLATFORMS.includes(platform));
    if (!cleanPlatforms.length) {
        const err = new Error('At least one valid platform is required.');
        err.status = 400;
        throw err;
    }
    const prompt = await getPromptTextOrFallback('up_post', UP_POST_PROMPT_FALLBACK, {
        SOURCE_CONTENT_ID: source.source_content_id,
        SOURCE_JSON: JSON.stringify(source.content),
        PLATFORMS: JSON.stringify(cleanPlatforms),
        POST_OPTIONS: JSON.stringify({
            scheduled_time: scheduledTime,
            campaign_tag: options.campaign_tag || null,
            post_type: options.post_type || null,
            tone: options.tone || 'rõ ràng, có CTA',
            cta_type: options.cta_type || 'engagement_or_click'
        })
    });
    let aiData = {};
    let warnings = [];
    try {
        aiData = await callGemini(prompt, { endpoint: 'up_post', skipCache: true });
    } catch (err) {
        warnings.push(`Gemini error: ${err.message}`);
    }
    const normalized = normalizeUpPostResponse(aiData, source, cleanPlatforms, scheduledTime, options);
    normalized.warnings = [...new Set([...normalized.warnings, ...warnings])];
    for (const post of normalized.posts) {
        const queuePayload = {
            post_id: post.post_id,
            source_content_id: post.source_content_id,
            platform: post.platform,
            post_type: post.post_type,
            body: post.body,
            title: post.title,
            hook: post.hook,
            CTA: post.CTA,
            hashtags: post.hashtags,
            scheduled_time: post.scheduled_time
        };
        await db.query(`
            INSERT INTO up_post_variants
                (post_id, source_content_id, source_type, platform, post_data, status, queue_payload, scheduled_time, schema_version, updated_at)
            VALUES ($1, $2, $3, $4, $5, 'draft', $6, $7, 'UP_POST_V1', NOW())
            ON CONFLICT (post_id) DO UPDATE SET
                post_data = EXCLUDED.post_data,
                queue_payload = EXCLUDED.queue_payload,
                scheduled_time = EXCLUDED.scheduled_time,
                updated_at = NOW()
        `, [post.post_id, post.source_content_id, source.source_type, post.platform, JSON.stringify(post), JSON.stringify(queuePayload), post.scheduled_time]);
    }
    return normalized;
}

async function refreshLegacyResearchPage(page, options = {}) {
    const config = LEGACY_PAGE_CONFIG[page];
    if (!config) throw new Error(`Unsupported research page: ${page}`);

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
    const prompt = await getPromptText(config.promptType, variables);
    const quota = await getQuota();
    const useLite = options.useLite ?? !!(quota && quota.request_count >= quota.soft_cap);
    const aiData = await callGemini(prompt, { endpoint: config.promptType, skipCache: true, useLite });
    const rawItems = extractList(aiData, config.listKeys).slice(0, config.limit);
    const validItems = validateItems(rawItems, config.required);

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

// ─── Lấy danh sách Trend ──────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const market = req.query.market || 'vn';
        const categoriesStr = req.query.categories || 'all';
        const categories = parseCategories(categoriesStr);
        const limit = parseInt(req.query.limit || '8', 10);
        const window = normalizeWindow(req.query.window || 'today');
        const mode = req.query.mode || 'overview';
        const page = parseInt(req.query.page || '1', 10);
        const requestedDate = req.query.date || null;
        const forceFresh = req.query.forceFresh === 'true' || req.query.refresh === 'true';

        const dateInfo = await resolveProductTrendDate({ requestedDate, market, categories, window });
        const resolvedDate = dateInfo.resolvedDate;
        const shouldReadByDate = requestedDate || (!forceFresh && resolvedDate);

        let result;
        if (shouldReadByDate) {
            const data = await loadProductTrendRows({ market, categories, window, limit, date: resolvedDate });
            result = { data, is_stale: false, schema_version: 'V4.0.1', from_db_date: resolvedDate };
        } else {
            const generationCategories = isAllCategories(categories)
                ? ['Skincare', 'Gia dụng', 'Fitness', 'Thời trang', 'Mẹ & bé']
                : categories;
            result = await getProductTrends({ market, categories: generationCategories, limit, window, mode, forceFresh });
        }

        const total = result.data.length; // Simplified total

        res.json({
            meta: {
                schema_version: result.schema_version,
                market,
                window,
                date: resolvedDate,
                ...buildDateMeta({
                    page: 'trends_v4',
                    requestedDate,
                    resolvedDate,
                    availableDates: dateInfo.availableDates,
                    rowCount: total,
                    extra: {
                        categories,
                        from_db_date: result.from_db_date || null
                    }
                }),
                mode,
                generated_at: new Date().toISOString(),
                is_stale: result.is_stale,
                pagination: {
                    page,
                    limit,
                    total,
                    has_more: false // Assuming we return all we have up to limit
                }
            },
            data: result.data
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Legacy Pages (Backward Compatibility) ───────────────────────────

router.get('/page-1', async (req, res) => {
    try {
        const requestedDate = req.query.date || null;
        const dateInfo = await resolveLegacyDate('mmo', requestedDate);
        const data = await loadLegacyPageRows('mmo', dateInfo.resolvedDate);
        res.json({
            success: true,
            data,
            meta: {
                source: 'database',
                date: dateInfo.resolvedDate,
                ...buildDateMeta({
                    page: 'mmo',
                    requestedDate,
                    resolvedDate: dateInfo.resolvedDate,
                    availableDates: dateInfo.availableDates,
                    rowCount: data.length
                }),
                count: data.length,
                latest_generated_at: data[0]?.created_at || data[0]?.generated_at || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/page-2', async (req, res) => {
    try {
        const requestedDate = req.query.date || null;
        const dateInfo = await resolveLegacyDate('ai_tools', requestedDate);
        const data = await loadLegacyPageRows('ai_tools', dateInfo.resolvedDate);
        res.json({
            success: true,
            data,
            meta: {
                source: 'database',
                date: dateInfo.resolvedDate,
                ...buildDateMeta({
                    page: 'ai_tools',
                    requestedDate,
                    resolvedDate: dateInfo.resolvedDate,
                    availableDates: dateInfo.availableDates,
                    rowCount: data.length
                }),
                count: data.length,
                latest_generated_at: data[0]?.created_at || data[0]?.generated_at || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/page-3', async (req, res) => {
    try {
        const requestedDate = req.query.date || null;
        const dateInfo = await resolveLegacyDate('suggestions', requestedDate);
        const data = await loadLegacyPageRows('suggestions', dateInfo.resolvedDate);
        res.json({
            success: true,
            data,
            meta: {
                source: 'database',
                date: dateInfo.resolvedDate,
                ...buildDateMeta({
                    page: 'suggestions',
                    requestedDate,
                    resolvedDate: dateInfo.resolvedDate,
                    availableDates: dateInfo.availableDates,
                    rowCount: data.length
                }),
                count: data.length,
                latest_generated_at: data[0]?.created_at || null
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Quota & Usage ────────────────────────────────────────────────────

router.get('/usage', async (req, res) => {
    try {
        const { getQuota } = require('./gemini');
        const quota = await getQuota();

        const { date, endpoint, limit = 20 } = req.query;
        const params = [];
        const where = [];
        if (date) {
            params.push(date);
            where.push(`${localDateSql('created_at')} = $${params.length}`);
        }
        if (endpoint && endpoint !== 'all') {
            params.push(endpoint);
            where.push(`endpoint = $${params.length}`);
        }
        params.push(parseInt(limit, 10));
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const recentRes = await db.query(`
            SELECT * FROM api_usage_logs
            ${whereSql}
            ORDER BY created_at DESC
            LIMIT $${params.length}
        `, params);

        res.json({ success: true, quota, recent_calls: recentRes.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/usage/daily', async (req, res) => {
    try {
        await ensureUpPostTables();
        const page = parseInt(req.query.page || '1');
        const limit = parseInt(req.query.limit || '7');
        const endpoint = req.query.endpoint || 'all';
        const offset = (page - 1) * limit;
        const filterParams = [];
        const filter = [];
        if (endpoint !== 'all') {
            filterParams.push(endpoint);
            filter.push(`endpoint = $${filterParams.length}`);
        }
        const whereSql = filter.length ? `WHERE ${filter.join(' AND ')}` : '';

        const allDaysSql = `
            SELECT ${localDateKeySql('created_at')} as day FROM api_usage_logs ${whereSql}
            UNION
            SELECT ${localDateKeySql('created_at')} as day FROM research_results
            UNION
            SELECT ${localDateKeySql('created_at')} as day FROM ai_suggestions
            UNION
            SELECT ${localDateKeySql('created_at')} as day FROM product_trend_results
            UNION
            SELECT ${localDateKeySql('created_at')} as day FROM aff_video_plans
            UNION
            SELECT ${localDateKeySql('created_at')} as day FROM up_post_variants
        `;
        const countRes = await db.query(`SELECT COUNT(*) FROM (${allDaysSql}) all_days`, filterParams);
        const totalDays = parseInt(countRes.rows[0].count);

        const dailyRes = await db.query(`
            WITH all_days AS (${allDaysSql}),
            paged_days AS (
                SELECT day
                FROM all_days
                ORDER BY day DESC
                LIMIT $${filterParams.length + 1} OFFSET $${filterParams.length + 2}
            ),
            usage_by_day AS (
                SELECT
                    ${localDateKeySql('created_at')} as day,
                    endpoint,
                    COUNT(*) as requests,
                    COALESCE(SUM(prompt_tokens), 0) as prompt_tokens,
                    COALESCE(SUM(output_tokens), 0) as output_tokens,
                    COALESCE(SUM(total_tokens), 0) as total_tokens,
                    COUNT(*) FILTER (WHERE cache_hit = TRUE) as cache_hits
                FROM api_usage_logs
                ${whereSql}
                GROUP BY day, endpoint
            )
            SELECT
                paged_days.day,
                COALESCE(usage_by_day.endpoint, 'research_data') as endpoint,
                COALESCE(usage_by_day.requests, 0) as requests,
                COALESCE(usage_by_day.prompt_tokens, 0) as prompt_tokens,
                COALESCE(usage_by_day.output_tokens, 0) as output_tokens,
                COALESCE(usage_by_day.total_tokens, 0) as total_tokens,
                COALESCE(usage_by_day.cache_hits, 0) as cache_hits
            FROM paged_days
            LEFT JOIN usage_by_day ON usage_by_day.day = paged_days.day
            ORDER BY paged_days.day DESC, usage_by_day.requests DESC NULLS LAST
        `, [...filterParams, limit, offset]);

        const totalsRes = await db.query(`
            SELECT
                COUNT(*) as total_requests,
                SUM(prompt_tokens) as total_prompt_tokens,
                SUM(output_tokens) as total_output_tokens,
                SUM(total_tokens) as total_tokens,
                COUNT(*) FILTER (WHERE cache_hit = TRUE) as cache_hits
            FROM api_usage_logs
            ${whereSql}
        `, filterParams);

        res.json({
            success: true,
            page,
            limit,
            total_days: totalDays,
            totals: totalsRes.rows[0],
            daily: dailyRes.rows
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/date-availability', async (req, res) => {
    try {
        await ensureUpPostTables();
        const [
            legacyRes,
            suggestionsRes,
            trendsRes,
            affRes,
            upPostRes
        ] = await Promise.all([
            db.query(`
                SELECT page_type, ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
                FROM research_results
                WHERE page_type IN ('mmo', 'ai_tools')
                GROUP BY page_type, day
                ORDER BY day DESC
            `),
            db.query(`
                SELECT ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
                FROM ai_suggestions
                GROUP BY day
                ORDER BY day DESC
            `),
            db.query(`
                SELECT ${localDateKeySql('created_at')} as day, source_window, COUNT(*)::INT as count
                FROM product_trend_results
                GROUP BY day, source_window
                ORDER BY day DESC
            `),
            db.query(`
                SELECT ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
                FROM aff_video_plans
                GROUP BY day
                ORDER BY day DESC
            `),
            db.query(`
                SELECT ${localDateKeySql('created_at')} as day, COUNT(*)::INT as count
                FROM up_post_variants
                GROUP BY day
                ORDER BY day DESC
            `)
        ]);

        const pages = {
            mmo: {},
            ai_market: {},
            suggestions: {},
            trends_v4: {},
            aff_vid: {},
            up_post: {}
        };
        const addCount = (page, day, count) => {
            if (!day) return;
            pages[page][day] = (pages[page][day] || 0) + Number(count || 0);
        };
        legacyRes.rows.forEach(row => {
            addCount(row.page_type === 'mmo' ? 'mmo' : 'ai_market', row.day, row.count);
        });
        suggestionsRes.rows.forEach(row => addCount('suggestions', row.day, row.count));
        trendsRes.rows.forEach(row => addCount('trends_v4', row.day, row.count));
        affRes.rows.forEach(row => addCount('aff_vid', row.day, row.count));
        upPostRes.rows.forEach(row => addCount('up_post', row.day, row.count));

        const allDays = new Set();
        Object.values(pages).forEach(map => Object.keys(map).forEach(day => allDays.add(day)));
        const availableDates = Array.from(allDays).sort().reverse();
        const windowsByDate = {};
        trendsRes.rows.forEach(row => {
            if (!windowsByDate[row.day]) windowsByDate[row.day] = {};
            windowsByDate[row.day][row.source_window || 'unknown'] = Number(row.count || 0);
        });

        res.json({
            success: true,
            latest_available_date: availableDates[0] || null,
            selected_date: req.query.date || null,
            available_dates: availableDates,
            counts_by_page: pages,
            windows_by_date: windowsByDate
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/cooldown', async (req, res) => {
    try {
        const { getQuota } = require('./gemini');
        const quota = await getQuota();
        const blockedUntil = quota?.blocked_until ? new Date(quota.blocked_until).getTime() : 0;
        const remaining = blockedUntil ? Math.max(Math.ceil((blockedUntil - Date.now()) / 1000), 0) : 0;
        const blocked = !!quota?.is_blocked || remaining > 0 || quota?.request_count >= quota?.hard_cap;
        res.json({
            dev_mode: process.env.NODE_ENV === 'development',
            quota,
            pages: {
                product_trends: { is_blocked: blocked, remaining_seconds: remaining, blocked_until: blockedUntil },
                deep_dive: { is_blocked: blocked, remaining_seconds: remaining, blocked_until: blockedUntil },
                opportunity: { is_blocked: blocked, remaining_seconds: remaining, blocked_until: blockedUntil }
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/overview', async (req, res) => {
    try {
        const { date, endpoint = 'all' } = req.query;
        const params = [];
        const usageWhere = [];
        if (date) {
            params.push(date);
            usageWhere.push(`${localDateSql('created_at')} = $${params.length}`);
        }
        if (endpoint !== 'all') {
            params.push(endpoint);
            usageWhere.push(`endpoint = $${params.length}`);
        }
        const usageWhereSql = usageWhere.length ? `WHERE ${usageWhere.join(' AND ')}` : '';
        const usage = await db.query(`
            SELECT COUNT(*) as requests,
                   SUM(prompt_tokens) as prompt_tokens,
                   SUM(output_tokens) as output_tokens,
                   SUM(total_tokens) as total_tokens,
                   COUNT(*) FILTER (WHERE cache_hit = TRUE) as cache_hits
            FROM api_usage_logs
            ${usageWhereSql}
        `, params);
        const trendParams = [];
        const trendWhere = [];
        if (date) {
            trendParams.push(date);
            trendWhere.push(`${localDateSql('created_at')} = $${trendParams.length}`);
        }
        const trendWhereSql = trendWhere.length ? `WHERE ${trendWhere.join(' AND ')}` : '';
        const trends = await db.query(`
            SELECT COUNT(*) as products,
                   COUNT(DISTINCT category) as categories,
                   MAX(created_at) as latest_generated_at
            FROM product_trend_results
            ${trendWhereSql}
        `, trendParams);
        const byCategory = await db.query(`
            SELECT category, COUNT(*) as count
            FROM product_trend_results
            ${trendWhereSql}
            GROUP BY category
            ORDER BY count DESC
            LIMIT 10
        `, trendParams);
        const legacyParams = [];
        const legacyWhere = [];
        if (date) {
            legacyParams.push(date);
            legacyWhere.push(`${localDateSql('created_at')} = $${legacyParams.length}`);
        }
        const legacyWhereSql = legacyWhere.length ? `AND ${legacyWhere.join(' AND ')}` : '';
        const legacyResults = await db.query(`
            SELECT page_type, COUNT(*) as count, MAX(created_at) as latest_generated_at
            FROM research_results
            WHERE page_type IN ('mmo', 'ai_tools') ${legacyWhereSql}
            GROUP BY page_type
        `, legacyParams);
        const suggestions = await db.query(`
            SELECT COUNT(*) as count, MAX(created_at) as latest_generated_at
            FROM ai_suggestions
            ${date ? `WHERE ${localDateSql('created_at')} = $1` : ''}
        `, date ? [date] : []);
        const legacy = {
            mmo: { count: 0, latest_generated_at: null },
            ai_tools: { count: 0, latest_generated_at: null },
            suggestions: {
                count: parseInt(suggestions.rows[0]?.count || 0, 10),
                latest_generated_at: suggestions.rows[0]?.latest_generated_at || null
            }
        };
        legacyResults.rows.forEach(row => {
            legacy[row.page_type] = {
                count: parseInt(row.count || 0, 10),
                latest_generated_at: row.latest_generated_at
            };
        });
        res.json({
            success: true,
            filters: { date: date || null, endpoint },
            usage: usage.rows[0],
            trends: trends.rows[0],
            categories: byCategory.rows,
            legacy
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Prompt Management ───────────────────────────────────────────────

router.get('/prompts', async (req, res) => {
    try {
        const result = await db.query('SELECT * FROM research_prompts ORDER BY page_type, updated_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/prompts', async (req, res) => {
    try {
        const { id, page_type, variant_name, prompt_text, set_active } = req.body;
        if (id) {
            await db.query(
                'UPDATE research_prompts SET page_type=$1, variant_name=$2, prompt_text=$3, updated_at=NOW() WHERE id=$4',
                [page_type, variant_name, prompt_text, id]
            );
            if (set_active) {
                await db.query('UPDATE research_prompts SET is_active=FALSE WHERE page_type=$1', [page_type]);
                await db.query('UPDATE research_prompts SET is_active=TRUE WHERE id=$1', [id]);
            }
            res.json({ success: true, message: 'Updated' });
        } else {
            const insRes = await db.query(
                'INSERT INTO research_prompts (page_type, variant_name, prompt_text, is_active) VALUES ($1, $2, $3, $4) RETURNING id',
                [page_type, variant_name, prompt_text, !!set_active]
            );
            if (set_active) {
                await db.query('UPDATE research_prompts SET is_active=FALSE WHERE page_type=$1 AND id != $2', [page_type, insRes.rows[0].id]);
            }
            res.json({ success: true, id: insRes.rows[0].id });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/prompts/:id/activate', async (req, res) => {
    try {
        const id = req.params.id;
        const pRes = await db.query('SELECT page_type FROM research_prompts WHERE id=$1', [id]);
        if (pRes.rows.length > 0) {
            const pageType = pRes.rows[0].page_type;
            await db.query('UPDATE research_prompts SET is_active=FALSE WHERE page_type=$1', [pageType]);
            await db.query('UPDATE research_prompts SET is_active=TRUE WHERE id=$1', [id]);
            res.json({ success: true });
        } else {
            res.status(404).json({ error: 'Not found' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/prompts/:id', async (req, res) => {
    try {
        await db.query('DELETE FROM research_prompts WHERE id=$1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Gemini Testing ──────────────────────────────────────────────────

router.post('/test-gemini', async (req, res) => {
    try {
        const testPrompt = "Return a JSON object with a 'status' field set to 'ok' and a 'message' field saying 'Gemini is working'.";
        const result = await callGemini(testPrompt, { endpoint: 'test', useLite: !!req.body.useLite });
        res.json({ success: true, data: result, use_lite: !!req.body.useLite });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Lấy chi tiết 1 sản phẩm ──────────────────────────────────────────
// AFF VID: biến kết quả research thành kế hoạch video affiliate có cấu trúc.
router.get('/aff-vid/source-products', async (req, res) => {
    try {
        await ensureAffVideoTable();
        const { market = 'vn', limit = 12 } = req.query;
        const requestedDate = req.query.date || null;
        const window = normalizeWindow(req.query.window || 'today');
        const categories = parseCategories(req.query.categories || 'all');
        const dateInfo = await resolveProductTrendDate({ requestedDate, market, categories, window });
        const resolvedDate = dateInfo.resolvedDate;
        const candidates = await loadAffVideoCandidates({
            date: resolvedDate,
            market,
            window,
            categories,
            limit: parseInt(limit, 10)
        });
        res.json({
            success: true,
            meta: {
                source: 'product_trend_results',
                market,
                window,
                categories,
                date: resolvedDate,
                count: candidates.length,
                ...buildDateMeta({
                    page: 'aff_vid_sources',
                    requestedDate,
                    resolvedDate,
                    availableDates: dateInfo.availableDates,
                    rowCount: candidates.length
                })
            },
            data: candidates
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/aff-vid/plans', async (req, res) => {
    try {
        await ensureAffVideoTable();
        const { product_id } = req.query;
        const params = [];
        const where = [];
        if (product_id) {
            params.push(product_id);
            where.push(`product_id = $${params.length}`);
        }
        params.push(parseInt(req.query.limit || '20', 10));
        const result = await db.query(`
            SELECT id, product_id, plan_data, status, platform_targets, source_window, schema_version, created_at
            FROM aff_video_plans
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY created_at DESC
            LIMIT $${params.length}
        `, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/aff-vid/generate', async (req, res) => {
    try {
        const {
            product_id,
            platform_targets = ['TikTok', 'Facebook Reels', 'Instagram Reels'],
            video_duration = '30-45s',
            tone = 'review thực tế',
            cta_type = 'affiliate_click',
            creator_persona = 'reviewer tiếng Việt',
            affiliate_url = null,
            language = 'vi'
        } = req.body || {};
        if (!product_id) {
            return res.status(400).json({ success: false, error: 'product_id is required.' });
        }
        const targets = Array.isArray(platform_targets) ? platform_targets : [platform_targets];
        const plan = await generateAffVideoPlan(product_id, targets, {
            video_duration,
            tone,
            cta_type,
            creator_persona,
            affiliate_url,
            language
        });
        res.json({ success: true, data: plan });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// UP POST: biến AFF VID/research content thành post variants theo từng nền tảng.
router.get('/up-post/sources', async (req, res) => {
    try {
        const requestedDate = req.query.date || null;
        const sourceType = req.query.source_type || 'aff_vid';
        const dates = await getUpPostAvailableDates(sourceType);
        const resolvedDate = requestedDate || dates[0]?.day || null;
        const sources = await loadUpPostSources({
            limit: parseInt(req.query.limit || '20', 10),
            sourceType,
            date: resolvedDate
        });
        res.json({
            success: true,
            meta: buildDateMeta({
                page: 'up_post_sources',
                requestedDate,
                resolvedDate,
                availableDates: dates.map(row => row.day),
                rowCount: sources.length,
                extra: { source_type: sourceType }
            }),
            data: sources
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/up-post/variants', async (req, res) => {
    try {
        await ensureUpPostTables();
        const params = [];
        const where = [];
        if (req.query.status) {
            params.push(req.query.status);
            where.push(`status = $${params.length}`);
        }
        if (req.query.platform) {
            params.push(req.query.platform);
            where.push(`platform = $${params.length}`);
        }
        if (req.query.source_content_id) {
            params.push(req.query.source_content_id);
            where.push(`source_content_id = $${params.length}`);
        }
        if (req.query.date) {
            params.push(req.query.date);
            where.push(`${localDateSql('created_at')} = $${params.length}`);
        }
        params.push(parseInt(req.query.limit || '30', 10));
        const result = await db.query(`
            SELECT id, post_id, source_content_id, source_type, platform, post_data, status, queue_payload, scheduled_time, schema_version, created_at
            FROM up_post_variants
            ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
            ORDER BY created_at DESC
            LIMIT $${params.length}
        `, params);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/up-post/generate', async (req, res) => {
    try {
        const {
            source_content_id,
            source_type = 'aff_vid',
            platforms = UP_POST_PLATFORMS,
            scheduled_time = null,
            campaign_tag = null,
            post_type = null,
            tone = 'rõ ràng, có CTA',
            cta_type = 'engagement_or_click'
        } = req.body || {};
        if (!source_content_id) {
            return res.status(400).json({ success: false, error: 'source_content_id is required.' });
        }
        const result = await generateUpPosts({
            sourceContentId: source_content_id,
            sourceType: source_type,
            platforms: Array.isArray(platforms) ? platforms : [platforms],
            scheduledTime: scheduled_time,
            options: { campaign_tag, post_type, tone, cta_type }
        });
        res.json({ success: true, data: result });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

router.post('/up-post/enqueue', async (req, res) => {
    try {
        await ensureUpPostTables();
        const { post_ids = [] } = req.body || {};
        if (!Array.isArray(post_ids) || post_ids.length === 0) {
            return res.status(400).json({ success: false, error: 'post_ids array is required.' });
        }
        const result = await db.query(`
            UPDATE up_post_variants
            SET status = 'queued', updated_at = NOW()
            WHERE post_id = ANY($1)
            RETURNING post_id, platform, queue_payload, status
        `, [post_ids]);
        res.json({ success: true, data: result.rows });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const productId = req.params.id;

        // Overview from DB
        const baseRes = await db.query(`SELECT raw_data FROM product_trend_results WHERE product_id = $1`, [productId]);
        if (baseRes.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const overview = baseRes.rows[0].raw_data;

        // Fetch deep dive
        const deepDive = await getProductDetail(productId, 'deep_dive');
        const opportunity = await getProductDetail(productId, 'opportunity');

        res.json({
            meta: { schema_version: 'V4.0.1', product_id: productId },
            data: {
                overview,
                deep_dive: deepDive,
                opportunity
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Refresh thủ công ──────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    try {
        const { page, market = 'vn', categories = ['Skincare', 'Gia dụng'], source_window = 'today', mode = 'overview' } = req.body;

        if (page === 'trends' || !page) {
            const result = await getProductTrends({ market, categories, window: source_window, mode, limit: 10, forceFresh: true, useLite: !!req.body.useLite });
            return res.json({ success: true, message: 'Refreshed trends successfully.', count: result.data.length, use_lite: !!req.body.useLite });
        }

        const result = await refreshLegacyResearchPage(page, { source_window, useLite: req.body.useLite });
        res.json({
            success: true,
            message: `Refreshed ${page} successfully.`,
            count: result.count,
            use_lite: result.use_lite
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Thao tác quản trị nội bộ ─────────────────────────────────────────

router.post('/admin/run-daily-job', async (req, res) => {
    const { researchQueue } = require('./queue');
    const date = new Date().toISOString().split('T')[0];
    await researchQueue.add('manual-research', {}, {
        jobId: `trend_manual_${date}`
    });
    res.json({ success: true, message: 'Daily trend job queued in background.' });
});

router.post('/admin/reset-quota', async (req, res) => {
    try {
        await db.query(`
            UPDATE quota_state SET
                request_count = 0, prompt_tokens = 0, output_tokens = 0,
                total_tokens = 0, cache_hits = 0, is_blocked = FALSE,
                blocked_until = NULL, blocked_model = NULL,
                date = CURRENT_DATE, updated_at = NOW()
            WHERE id = 1
        `);
        const { setBlocked } = require('./gemini');
        await setBlocked(false);
        res.json({ success: true, message: 'Quota reset.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
