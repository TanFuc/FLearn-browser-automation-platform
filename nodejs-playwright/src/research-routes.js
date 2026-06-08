/**
 * Product Trend API Routes V4.0.1
 * Mounted at /api/product-trends
 */
const express = require('express');
const router = express.Router();
const db = require('./db');
const {
    getProductTrends,
    getProductDetail,
    runDailyTrendResearch,
    refreshLegacyResearchPage: refreshLegacyResearchPageService
} = require('./research-service');
const { callGemini, getQuota } = require('./gemini');
const upPostService = require('./up-post-service');
const { addAffVidJob } = require('./queue');
const { emitSystemLog } = require('./logger');
const RESEARCH_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Ho_Chi_Minh';
const MIN_RESEARCH_RESULTS = 10;
const MAX_RESEARCH_RESULTS = 15;
const DEFAULT_RESEARCH_RESULTS = 15;
const AFF_VID_STATUSES = ['draft', 'rendering', 'rendered', 'posting', 'posted', 'failed'];
const UP_POST_PATCH_STATUSES = ['draft', 'validated', 'queued', 'posting', 'published', 'failed'];
const AI_MARKET_MIN_RESULTS = 18;
const AI_MARKET_MAX_RESULTS = 30;
const DEFAULT_AI_MARKET_RESULTS = 25;

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

function parseDateKey(value) {
    if (!value) return null;
    const text = String(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00Z`);
    return Number.isNaN(date.getTime()) ? null : date;
}

function sourceWindowDays(window) {
    if (window === 'today') return 0;
    if (window === 'last_3_days') return 3;
    return 7;
}

function isDateInsideWindow(value, window = 'last_7_days') {
    const sourceDate = parseDateKey(value);
    const today = parseDateKey(currentLocalDate());
    if (!sourceDate || !today) return false;
    const diffDays = Math.floor((today - sourceDate) / 86400000);
    return diffDays >= 0 && diffDays <= sourceWindowDays(window);
}

function hasDateInsideWindow(values, window = 'last_7_days') {
    const list = Array.isArray(values) ? values : [values];
    return list.some(value => isDateInsideWindow(value, window));
}

function normalizeWindow(value = 'last_7_days') {
    const map = {
        '3d': 'last_3_days',
        '7d': 'last_7_days',
        'last3': 'last_3_days',
        'last7': 'last_7_days',
        'last_3_days': 'last_3_days',
        'last_7_days': 'last_7_days',
        today: 'today'
    };
    return map[String(value || 'last_7_days')] || String(value || 'last_7_days');
}

function clampResearchLimit(value, fallback = DEFAULT_RESEARCH_RESULTS, max = MAX_RESEARCH_RESULTS, min = MIN_RESEARCH_RESULTS) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function shouldUseLiteForLegacyPage(page, quota, explicitValue) {
    if (explicitValue !== undefined) return !!explicitValue;
    return page === 'suggestions' ? !!(quota && quota.request_count >= quota.soft_cap) : false;
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
        limit: DEFAULT_RESEARCH_RESULTS
    },
    ai_tools: {
        promptType: 'ai_tools',
        table: 'research_results',
        listKeys: ['items', 'tools', 'ai_tools', 'tool_list', 'tools_list', 'data', 'results'],
        required: ['tool_name', 'tool_type', 'use_case'],
        defaultTopics: ['AI tools', 'GitHub trending', 'coding assistants', 'agent AI', 'automation tools', 'open-source AI', 'AI video', 'AI data tools'],
        minResults: AI_MARKET_MIN_RESULTS,
        limit: DEFAULT_AI_MARKET_RESULTS
    },
    suggestions: {
        promptType: 'suggestions',
        table: 'ai_suggestions',
        listKeys: ['items', 'suggestions', 'recommendations', 'data', 'results'],
        required: ['recommendation_title'],
        defaultTopics: ['AI tools', 'MMO opportunities', 'weekly market signals', 'automation workflows'],
        limit: DEFAULT_RESEARCH_RESULTS
    }
};

function buildAiToolsRetryPrompt({ currentDate, sourceWindow, limit }) {
    const boundedLimit = clampResearchLimit(limit, DEFAULT_AI_MARKET_RESULTS, AI_MARKET_MAX_RESULTS, AI_MARKET_MIN_RESULTS);
    return `Return valid RFC8259 JSON array only. No markdown. No explanation.
Current date: ${currentDate}.
Task: find ${AI_MARKET_MIN_RESULTS} to ${boundedLimit} AI tools, AI projects, or AI platforms that are popular, fast-rising, newly launched, newly updated, newly discounted, or strategically useful in the current week ending ${currentDate}.
Freshness: use only source evidence dated inside ${sourceWindow} relative to ${currentDate}. For last_7_days, source_date must be inside the last 7 days. Do not include evergreen old brands unless there is fresh dated evidence and a clear "why now" trigger.
Required sources: start with GitHub Trending daily at https://github.com/trending?since=daily&spoken_language_code= for developer/open-source AI tools, then cross-check with at least 3 independent source classes when available: Reddit, X/Twitter, Hacker News, Product Hunt, official launch/changelog/forum pages, fast-growing GitHub repos/releases, creator demos, reputable newsletters, pricing/discount pages, or credible tech press.
Research broadly and return the most important, hot, popular, useful, and high-signal tools. Daily repeats are allowed when the tool is still hot or still has strong fresh evidence.
Each item must explain WHY NOW in evidence_summary/market_signal and name the source class used. Prefer signals such as launch/update pages, repo momentum, Product Hunt/Hacker News activity, Reddit/X/community discussion, creator demos, pricing/deal pages, or credible news.
Do not invent tools, model names, rankings, dates, prices, stars, or viral claims. Return fewer than ${AI_MARKET_MIN_RESULTS} only when fewer are genuinely verifiable.
All user-facing prose must be Vietnamese only. Keep brand/tool names unchanged.
Scores must be integers from 0 to 100. Use confidence_score >= 70 only when source_url, source_date, and evidence_summary are concrete.
source_window must equal "${sourceWindow}".
Each object must include exactly these keys:
tool_name, tool_type, use_case, value_score, market_signal, market_reason, price_level, discount_or_launch_status, confidence_score, summary, best_value_reason, source_url, source_date, source_urls, source_dates, source_classes, source_window, github_trending_url, evidence_summary, popularity_signal, recent_trigger, is_best_value, is_new_noteworthy.
source_date format: YYYY-MM-DD.`;
}

function buildFreshnessAppendix({ page, currentDate, sourceWindow, limit }) {
    const boundedLimit = clampResearchLimit(limit);
    return `

SERVER-ENFORCED FRESHNESS AND POPULARITY CONTRACT:
- Current date: ${currentDate}.
- Requested source_window: ${sourceWindow}.
- Return ${MIN_RESEARCH_RESULTS}-${boundedLimit} ranked results. Prefer ${boundedLimit} when evidence is strong enough.
- Use only evidence whose source_date is inside ${sourceWindow} relative to ${currentDate}.
- Daily repeats are allowed only when evidence_summary/freshness_note explains the fresh signal inside ${sourceWindow}.
- Reject famous but stale evergreen items unless they have a dated fresh trigger: major update, newly viral content, marketplace rank movement, fresh creator/community discussion, current discount, new integration/model support, or renewed search demand.
- Use multiple source classes when available: TikTok/TikTok Shop, Shopee/Lazada/Amazon, Google Trends/search intent, YouTube Shorts, Reddit, X/Twitter, Facebook Groups, Product Hunt, Hacker News, GitHub Trending, official changelogs/blogs, newsletters, and niche communities.
- For code/open-source/developer tools, check GitHub Trending daily exactly at https://github.com/trending?since=daily&spoken_language_code= when relevant.
- Every research item must include source_url, source_date, evidence_summary, and source_window.
- source_window must equal "${sourceWindow}".
- confidence_score must be below 70 when evidence is missing, stale, generic, unverifiable, or only based on old reputation.
- Each item must include a clear "why now" signal in evidence_summary, market_signal, freshness_note, popularity_signal, or recent_trigger.
- This page is "${page}". Keep all user-facing prose in natural Vietnamese only.`;
}

const BILINGUAL_OUTPUT_INSTRUCTION = `

YEU CAU DINH DANG NGON NGU BAT BUOC:
- Tất cả nội dung hiển thị cho người dùng phải viết theo dạng: tiếng Việt (English).
- Ví dụ: "Chiến lược nội dung ngắn (Short-form content strategy)".
- Ap dung cho title, summary, content_angle, traffic_source, monetization_model, use_case, market_signal, market_reason, best_value_reason, recommendation_title, recommendation_text, reasoning_summary, next_action.
- Khong dich ten rieng cua cong cu, san pham, thuong hieu.
`;

const AFF_VIDEO_PROMPT_FALLBACK = `You are AFF VID Planner for Vietnamese short-form affiliate content.
Return valid JSON only. No markdown. No explanation.

TASK:
Create one actionable affiliate video plan from the supplied research product. Do not invent a new product.

QUALITY RULES:
- Vietnamese first. Keep wording direct, specific, and easy to record.
- Use source_window, source_dates/source_date, evidence_summary, popularity_signal, recent_trigger, and freshness_note from the input when present.
- Do not recycle old generic selling angles. If the input does not prove current demand, keep the angle conservative and list the missing proof.
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
- Use source_window, source_dates/source_date, evidence_summary, popularity_signal, recent_trigger, and freshness_note from the input when present.
- Do not recycle old evergreen copy. Hooks and bodies must reflect the current trigger when the source has one.
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

function confidenceScore(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    if (n > 0 && n <= 5) return score(n * 20, fallback);
    if (n > 5 && n <= 10) return score(n * 10, fallback);
    return score(n, fallback);
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
    return renderPrompt(r.rows[0].prompt_text, variables);
}

async function getActiveTopics(page = 'mmo') {
    const config = LEGACY_PAGE_CONFIG[page];
    if (config?.defaultTopics && page !== 'mmo') return config.defaultTopics;
    const r = await db.query(
        `SELECT name FROM research_topics
         WHERE is_active = TRUE
         ORDER BY created_at DESC
         LIMIT 12`
    );
    const topics = r.rows.map(row => row.name).filter(Boolean);
    return topics.length ? topics : (config?.defaultTopics || LEGACY_PAGE_CONFIG.mmo.defaultTopics);
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
        confidence_score: confidenceScore(item.confidence_score, 70),
        summary: item.summary || item.description || '',
        source_url: item.source_url || firstValue(item.source_urls) || item.url || '',
        source_date: item.source_date || firstValue(item.source_dates) || item.published_at || item.updated_at || '',
        evidence_summary: item.evidence_summary || item.evidence || item.market_signal || '',
        popularity_signal: item.popularity_signal || item.market_signal || '',
        recent_trigger: item.recent_trigger || item.evidence_summary || item.market_signal || '',
        generated_at: new Date().toISOString(),
        source_window: item.source_window || 'last_7_days'
    };
}

function normalizeAiToolItem(item, index) {
    const toolName = item.tool_name || item.name || item.title || `AI tool ${index + 1}`;
    const valueScore = score(item.value_score || item.score, 70);
    const priceLevel = item.price_level || item.pricing_model || 'freemium';
    const sourceUrls = normalizeEvidenceList(item.source_urls || item.supporting_sources || item.sources || item.urls || item.source_url || item.url || item.launch_url || item.github_url);
    const sourceDates = normalizeEvidenceList(item.source_dates || item.published_dates || item.source_date || item.published_at || item.updated_at || item.release_date);
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
        confidence_score: confidenceScore(item.confidence_score, 70),
        summary: item.summary || item.description || '',
        best_value_reason: item.best_value_reason || item.market_reason || item.reason || '',
        source_url: item.source_url || firstValue(sourceUrls) || '',
        source_date: item.source_date || firstValue(sourceDates) || '',
        source_urls: sourceUrls,
        source_dates: sourceDates,
        source_classes: Array.isArray(item.source_classes) ? item.source_classes.filter(Boolean) : [],
        source_window: item.source_window || 'last_7_days',
        github_trending_url: item.github_trending_url || '',
        evidence_summary: item.evidence_summary || item.evidence || item.market_signal || item.market_reason || '',
        popularity_signal: item.popularity_signal || item.market_signal || '',
        recent_trigger: item.recent_trigger || item.evidence_summary || item.market_signal || '',
        is_best_value: item.is_best_value ?? valueScore >= 85,
        is_new_noteworthy: item.is_new_noteworthy ?? ['emerging', 'new', 'launching'].includes(String(item.market_signal || item.status || '').toLowerCase()),
        generated_at: new Date().toISOString()
    };
}

function normalizeSuggestionItem(item, index) {
    const title = item.recommendation_title || item.title || `AI suggestion ${index + 1}`;
    const plan = Array.isArray(item.execution_plan) ? item.execution_plan.join('\n') : '';
    const sourceDates = normalizeEvidenceList(item.source_dates || item.source_date || item.published_dates || item.published_at || item.updated_at || item.release_date);
    return {
        recommendation_title: title,
        recommendation_text: item.recommendation_text || item.hook || item.summary || plan,
        confidence_score: confidenceScore(item.confidence_score, score(item.roi_score, 75)),
        urgency_score: score(item.urgency_score, 60),
        roi_score: score(item.roi_score, 70),
        reasoning_summary: item.reasoning_summary || item.risk || item.market_reason || '',
        next_action: item.next_action || (Array.isArray(item.execution_plan) ? item.execution_plan[0] : ''),
        supporting_sources: Array.isArray(item.supporting_sources) ? item.supporting_sources : [],
        source_dates: sourceDates,
        source_window: item.source_window || 'last_7_days',
        freshness_note: item.freshness_note || '',
        topic: item.topic || item.target_topic || item.category || 'General',
        raw_data: { ...item, generated_at: new Date().toISOString() }
    };
}

function validateItems(items, required) {
    return items.filter(item =>
        item && typeof item === 'object' && required.every(field => item[field] !== undefined && item[field] !== null && item[field] !== '')
    );
}

function hasAnyItemField(item, fields) {
    return fields.some(field => item[field] !== undefined && item[field] !== null && item[field] !== '');
}

function firstValue(value) {
    return Array.isArray(value) ? value.find(Boolean) : value;
}

function normalizeEvidenceList(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (!value) return [];
    return [value];
}

const LOW_QUALITY_SOURCE_PATTERNS = [
    /\/search(\?|\/|$)/i,
    /\/results\?search_query=/i,
    /tiktok\.com\/search/i,
    /instagram\.com\/explore\/tags/i,
    /facebook\.com\/search/i,
    /shopee\.[^/]+\/search/i,
    /lazada\.[^/]+\/search/i,
    /tiki\.vn\/search/i,
    /^https?:\/\/(?:www\.)?perplexity\.ai\/?$/i,
    /^https?:\/\/(?:www\.)?openai\.com\/api\/?$/i,
    /huggingface\.co\/docs\/transformers\/index/i,
    /technologyhits\.com/i,
    /\/top[-_]\d+/i,
    /\/best[-_].*ai/i,
    /best-ai/i,
    /everyone-is-googling/i,
    /subscription-deals/i,
    /alternatives/i
];

const GENERIC_EVIDENCE_PATTERNS = [
    /thường xuyên cập nhật/i,
    /liên tục cập nhật/i,
    /các bản cập nhật gần đây/i,
    /bản cập nhật mới nhất/i,
    /giữ vững vị thế/i,
    /vẫn duy trì/i,
    /tiếp tục (là|được|có|ghi nhận)/i,
    /lượng bán ổn định/i,
    /rất phổ biến/i,
    /chương trình (khuyến mãi|giảm giá)/i,
    /đa dạng (mẫu mã|dòng sản phẩm)/i,
    /các mẫu mới/i
];

const CONCRETE_SIGNAL_PATTERNS = [
    /\b20\d{2}-\d{2}-\d{2}\b/,
    /\b\d+(\.\d+)?\s?(%|k|m|triệu|nghìn|stars?|forks?|views?|lượt|đơn|review|đánh giá)\b/i,
    /\b(v|version|phiên bản)\s?\d+(\.\d+)?/i,
    /github trending/i,
    /product hunt/i,
    /hacker news/i,
    /release notes?/i,
    /changelog/i,
    /ra mắt ngày/i,
    /công bố ngày/i,
    /xếp hạng|top\s?\d+|rank/i,
    /tăng\s?\d+/i
];

function evidenceText(item = {}) {
    return [
        item.evidence_summary,
        item.market_signal,
        item.market_reason,
        item.popularity_signal,
        item.recent_trigger,
        item.freshness_note,
        item.reasoning_summary,
        item.recommendation_text
    ].filter(Boolean).join(' ');
}

function sourceUrlsOf(item = {}) {
    return normalizeEvidenceList(item.source_urls || item.supporting_sources || item.sources || item.urls || item.source_url || item.url || item.launch_url || item.github_url);
}

function isLowQualitySourceUrl(url) {
    const text = String(url || '').trim();
    if (!/^https?:\/\//i.test(text)) return true;
    return LOW_QUALITY_SOURCE_PATTERNS.some(pattern => pattern.test(text));
}

function hasUsefulSourceUrl(item = {}) {
    const urls = sourceUrlsOf(item);
    return urls.length > 0 && urls.some(url => !isLowQualitySourceUrl(url));
}

function isGenericEvidence(text) {
    const value = String(text || '').trim();
    if (!value || value.length < 80) return true;
    const genericHits = GENERIC_EVIDENCE_PATTERNS.filter(pattern => pattern.test(value)).length;
    const hasConcreteSignal = CONCRETE_SIGNAL_PATTERNS.some(pattern => pattern.test(value));
    return genericHits >= 1 && !hasConcreteSignal;
}

function hasQualityEvidence(item = {}) {
    const text = evidenceText(item);
    return hasUsefulSourceUrl(item) && !isGenericEvidence(text);
}

function hasFreshEvidenceFields(item, window = 'last_7_days') {
    const sourceDate = item.source_date || firstValue(item.source_dates) || item.published_at || item.updated_at || item.release_date;
    return (hasAnyItemField(item, ['source_url', 'url', 'launch_url', 'github_url']) || hasAnyItemField(item, ['source_urls']))
        && (hasAnyItemField(item, ['source_date', 'published_at', 'updated_at', 'release_date']) || hasAnyItemField(item, ['source_dates']))
        && hasAnyItemField(item, ['evidence_summary', 'evidence', 'market_signal', 'market_reason'])
        && isDateInsideWindow(sourceDate, window)
        && confidenceScore(item.confidence_score, 0) >= 70
        && hasQualityEvidence(item);
}

function validateLegacyItems(page, items, required) {
    if (!Array.isArray(items)) return [];
    const itemWindow = item => normalizeWindow(item.source_window || 'last_7_days');
    if (page === 'mmo') {
        return validateItems(items, required).filter(item => hasFreshEvidenceFields(item, itemWindow(item)));
    }
    if (page === 'suggestions') {
        return validateItems(items, required).filter(item => {
            if (!item || typeof item !== 'object') return false;
            const sources = Array.isArray(item.supporting_sources) ? item.supporting_sources.filter(Boolean) : [];
            const window = item.source_window || 'last_7_days';
            return sources.length > 0
                && hasAnyItemField(item, ['freshness_note', 'reasoning_summary'])
                && confidenceScore(item.confidence_score, 0) >= 70
                && hasDateInsideWindow(item.source_dates || item.source_date, window)
                && hasQualityEvidence(item);
        });
    }
    if (page !== 'ai_tools') return validateItems(items, required);
    return items.filter(item => {
        if (!item || typeof item !== 'object') return false;
        return hasAnyItemField(item, ['tool_name', 'name', 'title'])
            && hasAnyItemField(item, ['tool_type', 'type', 'category'])
            && hasAnyItemField(item, ['use_case', 'primary_use_case', 'summary', 'description'])
            && hasFreshEvidenceFields(item, itemWindow(item));
    });
}

function filterReadableLegacyRows(page, rows) {
    const config = LEGACY_PAGE_CONFIG[page];
    if (!config) return rows;
    if (!['mmo', 'ai_tools', 'suggestions'].includes(page)) return rows;
    const filtered = validateLegacyItems(page, rows, config.required);
    return filtered.length >= MIN_RESEARCH_RESULTS ? filtered : [];
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

async function getValidLegacyDateRows(page, dateRows) {
    const validRows = [];
    for (const row of dateRows) {
        const rows = await loadLegacyPageRows(page, row.day);
        if (rows.length >= MIN_RESEARCH_RESULTS) {
            validRows.push({ ...row, count: rows.length });
        }
    }
    return validRows;
}

async function resolveLegacyDate(page, requestedDate = null) {
    const dates = await getLegacyAvailableDates(page);
    const validDateRows = await getValidLegacyDateRows(page, dates);
    const availableDates = validDateRows.map(row => row.day);
    if (requestedDate) {
        return {
            requestedDate,
            resolvedDate: requestedDate,
            availableDates,
            countsByDate: validDateRows
        };
    }
    return {
        requestedDate: null,
        resolvedDate: availableDates[0] || null,
        availableDates,
        countsByDate: validDateRows
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
        return filterReadableLegacyRows(page, result.rows.map(row => ({ ...row, ...(row.raw_data || {}) })));
    }
    params.unshift(page);
    const adjustedDateWhere = where.length ? ` AND ${where.map((clause, idx) => clause.replace(`$${idx + 1}`, `$${idx + 2}`)).join(' AND ')}` : '';
    const result = await db.query(`SELECT * FROM research_results WHERE page_type = $1${adjustedDateWhere} ORDER BY created_at DESC`, params);
    return filterReadableLegacyRows(page, result.rows.map(r => ({ ...r, ...r.data })));
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

async function getValidProductTrendDateRows({ market = 'vn', categories = ['all'], window = 'today', dateRows = [] } = {}) {
    const normalizedWindow = normalizeWindow(window);
    const freshDateRows = dateRows.filter(row => isDateInsideWindow(row.day, normalizedWindow));
    const validRows = [];
    for (const row of freshDateRows) {
        const rows = await loadProductTrendRows({
            market,
            categories,
            window: normalizedWindow,
            limit: DEFAULT_RESEARCH_RESULTS,
            date: row.day
        });
        if (rows.length >= MIN_RESEARCH_RESULTS) {
            validRows.push({ ...row, count: rows.length });
        }
    }
    return validRows;
}

async function resolveProductTrendDate({ requestedDate = null, market = 'vn', categories = ['all'], window = 'today' } = {}) {
    const dates = await getProductTrendAvailableDates({ market, categories, window });
    const validDateRows = await getValidProductTrendDateRows({ market, categories, window, dateRows: dates });
    const availableDates = validDateRows.map(row => row.day);
    if (requestedDate) {
        return {
            requestedDate,
            resolvedDate: requestedDate,
            availableDates,
            countsByDate: validDateRows
        };
    }
    return {
        requestedDate: null,
        resolvedDate: availableDates[0] || null,
        availableDates,
        countsByDate: validDateRows
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
    const filtered = result.rows
        .map(row => row.raw_data)
        .filter(item => item
            && confidenceScore(item.confidence_score, 0) >= 70
            && hasDateInsideWindow(item.source_dates || item.source_date, normalizedWindow)
            && hasQualityEvidence(item));
    return filtered.length >= MIN_RESEARCH_RESULTS ? filtered : [];
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
    await db.query(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'aff_video_plans_status_check'
            ) THEN
                ALTER TABLE aff_video_plans
                ADD CONSTRAINT aff_video_plans_status_check
                CHECK (status IN ('draft', 'rendering', 'rendered', 'posting', 'posted', 'failed'));
            END IF;
        END $$;
    `);
}

async function ensureUpPostTables() {
    await upPostService.ensureUpPostTables();
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
        source_window: row.source_window || product.source_window || 'last_7_days',
        market: row.market,
        created_at: row.created_at
    };
}

async function loadAffVideoCandidates({ date, market = 'vn', window = 'last_7_days', categories = ['all'], limit = DEFAULT_RESEARCH_RESULTS }) {
    limit = clampResearchLimit(limit);
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
        angle: plan.angle || product.summary || product.search_intent || 'GÃ³c review nhanh dá»±a trÃªn tÃ­n hiá»‡u research',
        hook: plan.hook || `Sáº£n pháº©m ${product.product_name || product.id} cÃ³ gÃ¬ Ä‘Ã¡ng thá»­?`,
        script: Array.isArray(plan.script) && plan.script.length ? plan.script : [
            `Má»Ÿ Ä‘áº§u báº±ng váº¥n Ä‘á» cá»§a ngÆ°á»i mua trong ngÃ¡ch ${product.category || 'nÃ y'}.`,
            `Giá»›i thiá»‡u ${product.product_name || product.id} vÃ  lÃ½ do Ä‘ang cÃ³ tÃ­n hiá»‡u tÄƒng.`,
            'NÃªu 2 lá»£i Ã­ch thá»±c táº¿, dá»… nhÃ¬n tháº¥y khi quay video ngáº¯n.',
            'Káº¿t báº±ng lá»i kÃªu gá»i xem link hoáº·c bÃ¬nh luáº­n Ä‘á»ƒ nháº­n gá»£i Ã½.'
        ],
        shot_list: Array.isArray(plan.shot_list) && plan.shot_list.length ? plan.shot_list : [
            { shot: 1, visual: 'Cáº­n cáº£nh sáº£n pháº©m hoáº·c áº£nh marketplace', on_screen_text: plan.hook || 'Äang Ä‘Æ°á»£c chÃº Ã½', duration_seconds: 3, note: 'Má»Ÿ báº±ng chuyá»ƒn Ä‘á»™ng nhanh' },
            { shot: 2, visual: 'Demo váº¥n Ä‘á» trÆ°á»›c khi dÃ¹ng', on_screen_text: 'Váº¥n Ä‘á» thÆ°á»ng gáº·p', duration_seconds: 5, note: 'DÃ¹ng cáº£nh Ä‘á»i thÆ°á»ng' },
            { shot: 3, visual: 'Demo sáº£n pháº©m giáº£i quyáº¿t váº¥n Ä‘á»', on_screen_text: 'CÃ¡ch xá»­ lÃ½ nhanh', duration_seconds: 8, note: 'Quay rÃµ thao tÃ¡c' },
            { shot: 4, visual: 'Káº¿t quáº£ sau khi dÃ¹ng', on_screen_text: 'CÃ³ Ä‘Ã¡ng mua?', duration_seconds: 5, note: 'ÄÆ°a nháº­n xÃ©t ngáº¯n' }
        ],
        CTA: plan.CTA || plan.cta || 'Xem link sáº£n pháº©m vÃ  so sÃ¡nh giÃ¡ trÆ°á»›c khi mua.',
        caption: plan.caption || `${product.product_name || product.id} Ä‘ang cÃ³ tÃ­n hiá»‡u tá»‘t trong ngÃ¡ch ${product.category || 'affiliate'}.`,
        hashtags: Array.isArray(plan.hashtags) && plan.hashtags.length ? plan.hashtags : ['#reviewsanpham', '#tiktokshop', '#muasamthongminh', '#affiliate'],
        platform_targets: platformTargets,
        video_setup: {
            video_duration: options.video_duration || plan.video_duration || '30-45s',
            tone: options.tone || plan.tone || 'review thá»±c táº¿',
            cta_type: options.cta_type || plan.cta_type || 'affiliate_click',
            creator_persona: options.creator_persona || plan.creator_persona || 'reviewer tiáº¿ng Viá»‡t',
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
            source_window: product.source_window || 'last_7_days'
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
            tone: options.tone || 'review thá»±c táº¿',
            cta_type: options.cta_type || 'affiliate_click',
            creator_persona: options.creator_persona || 'reviewer tiáº¿ng Viá»‡t',
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
    const body = post.body || content.caption || content.angle || content.summary || `Báº£n nhÃ¡p cho ${baseTitle}.`;
    const hook = post.hook || content.hook || String(body).split(/[.!?]/)[0] || baseTitle;
    const cta = post.CTA || post.cta || content.CTA || content.cta || 'Xem thÃªm thÃ´ng tin trÆ°á»›c khi quyáº¿t Ä‘á»‹nh.';
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
            tone: options.tone || 'rÃµ rÃ ng, cÃ³ CTA',
            cta_type: options.cta_type || 'engagement_or_click',
            requested_post_type: options.post_type || null
        },
        confidence_score: score(post.confidence_score, content.confidence_score || 70),
        platform_fit_score: score(post.platform_fit_score, 70),
        validation_warnings: [...new Set([...(Array.isArray(post.validation_warnings) ? post.validation_warnings : []), ...warnings])]
    };
}

function platformSpecificBody(post, sourceContent) {
    const productName = sourceContent.product_name || sourceContent.title || 'sáº£n pháº©m nÃ y';
    const hook = post.hook || sourceContent.hook || productName;
    const cta = post.CTA || sourceContent.CTA || 'Xem thÃªm trÆ°á»›c khi quyáº¿t Ä‘á»‹nh.';
    if (post.platform === 'threads') {
        return `${hook}\n\n${productName} Ä‘ang Ä‘Ã¡ng chÃº Ã½ vÃ¬ giáº£i quyáº¿t Ä‘Ãºng má»™t nhu cáº§u ráº¥t cá»¥ thá»ƒ. Báº¡n cÃ³ muá»‘n mÃ¬nh tÃ¡ch checklist nÃªn mua/khÃ´ng nÃªn mua khÃ´ng?`;
    }
    if (post.platform === 'facebook') {
        return `${hook}\n\nNáº¿u báº¡n Ä‘ang tÃ¬m má»™t lá»±a chá»n thá»±c táº¿ trong nhÃ³m ${post.title || productName}, Ä‘iá»ƒm Ä‘Ã¡ng xem lÃ : váº¥n Ä‘á» nÃ³ giáº£i quyáº¿t, cÃ¡ch dÃ¹ng trong Ä‘á»i sá»‘ng háº±ng ngÃ y, vÃ  liá»‡u cÃ³ phÃ¹ há»£p nhu cáº§u cá»§a báº¡n khÃ´ng.\n\n${cta}`;
    }
    if (post.platform === 'tiktok_caption') {
        return `${hook} Xem nhanh trÆ°á»›c khi mua. ${cta}`;
    }
    if (post.platform === 'facebook_video') {
        return `${hook}\n\nTrong video nÃ y mÃ¬nh sáº½ Ä‘i tá»« váº¥n Ä‘á», cÃ¡ch sáº£n pháº©m xá»­ lÃ½, Ä‘áº¿n Ä‘iá»ƒm cáº§n cÃ¢n nháº¯c trÆ°á»›c khi mua.\n\n${cta}`;
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
            tone: options.tone || 'rÃµ rÃ ng, cÃ³ CTA',
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
    const targetDate = options.target_date || currentLocalDate();
    if (targetDate !== currentLocalDate()) {
        throw new Error(`Manual refresh only supports today's date (${currentLocalDate()}). Selected date: ${targetDate}.`);
    }
    await emitSystemLog('AI Research legacy refresh started', 'info', {
        page,
        target_date: targetDate,
        source_window: options.source_window || 'last_7_days'
    });

    if (page === 'suggestions') {
        const [mmoRows, aiRows] = await Promise.all([
            loadLegacyPageRows('mmo'),
            loadLegacyPageRows('ai_tools')
        ]);
        await emitSystemLog('AI Research suggestions dependency check', 'info', {
            mmo_rows: mmoRows.length,
            ai_tools_rows: aiRows.length
        });
        if (mmoRows.length === 0) await refreshLegacyResearchPage('mmo', options);
        if (aiRows.length === 0) await refreshLegacyResearchPage('ai_tools', options);
    }

    const topics = await getActiveTopics(page);
    await emitSystemLog('AI Research prompt context loaded', 'info', {
        page,
        topics: topics.length,
        target_date: targetDate
    });
    const variables = {
        TOPICS: topics.join(', '),
        PAGE1_DATA: JSON.stringify((await loadLegacyPageRows('mmo', targetDate)).slice(0, DEFAULT_RESEARCH_RESULTS)),
        PAGE2_DATA: JSON.stringify((await loadLegacyPageRows('ai_tools', targetDate)).slice(0, DEFAULT_AI_MARKET_RESULTS)),
        SOURCE_WINDOW: options.source_window || 'last_7_days',
        CURRENT_DATE: currentLocalDate(),
        LIMIT: page === 'ai_tools'
            ? clampResearchLimit(config.limit, DEFAULT_AI_MARKET_RESULTS, AI_MARKET_MAX_RESULTS, AI_MARKET_MIN_RESULTS)
            : config.limit
    };
    const prompt = page === 'ai_tools'
        ? buildAiToolsRetryPrompt({
            currentDate: variables.CURRENT_DATE,
            sourceWindow: variables.SOURCE_WINDOW,
            limit: variables.LIMIT
        })
        : `${await getPromptText(config.promptType, variables)}${buildFreshnessAppendix({
            page,
            currentDate: variables.CURRENT_DATE,
            sourceWindow: variables.SOURCE_WINDOW,
            limit: config.limit
        })}`;
    const quota = await getQuota();
    const useLite = shouldUseLiteForLegacyPage(page, quota, options.useLite);
    await emitSystemLog('AI Research Gemini call queued', 'info', { page, use_lite: useLite });
    const aiData = await callGemini(prompt, { endpoint: config.promptType, skipCache: true, useLite });
    const pageLimit = page === 'ai_tools'
        ? clampResearchLimit(config.limit, DEFAULT_AI_MARKET_RESULTS, AI_MARKET_MAX_RESULTS, AI_MARKET_MIN_RESULTS)
        : config.limit;
    let rawItems = extractList(aiData, config.listKeys).slice(0, pageLimit);
    let validItems = validateLegacyItems(page, rawItems, config.required);
    await emitSystemLog('AI Research Gemini response validated', 'info', {
        page,
        raw_items: rawItems.length,
        valid_items: validItems.length
    });

    if (page === 'ai_tools' && validItems.length === 0 && options.allowRetry !== false) {
        await emitSystemLog('AI Market validation empty, retrying strict prompt', 'warning', { page });
        const retryPrompt = buildAiToolsRetryPrompt({
            currentDate: variables.CURRENT_DATE,
            sourceWindow: variables.SOURCE_WINDOW,
            limit: pageLimit
        });
        const retryData = await callGemini(retryPrompt, { endpoint: config.promptType, skipCache: true, useLite: false });
        rawItems = extractList(retryData, config.listKeys).slice(0, pageLimit);
        validItems = validateLegacyItems(page, rawItems, config.required);
        await emitSystemLog('AI Market retry response validated', 'info', {
            raw_items: rawItems.length,
            valid_items: validItems.length
        });
    }

    if (validItems.length === 0) {
        throw new Error(`Gemini returned no valid ${page} items. Check active prompt schema.`);
    }
    const minResults = config.minResults || MIN_RESEARCH_RESULTS;
    if (validItems.length < minResults) {
        throw new Error(`Gemini returned only ${validItems.length} valid fresh ${page} items; refusing to write low-volume/low-confidence output.`);
    }

    if (page === 'mmo') {
        const normalized = validItems.map(normalizeMmoItem);
        const deleted = await db.query(
            `DELETE FROM research_results WHERE page_type = $1 AND ${localDateSql('created_at')} = $2`,
            ['mmo', targetDate]
        );
        await emitSystemLog('AI Research old rows cleared for target date', 'info', {
            page,
            target_date: targetDate,
            deleted_rows: deleted.rowCount
        });
        for (const item of normalized) {
            await db.query(
                `INSERT INTO research_results
                 (topic, page_type, title, category, data, trend_score, monetization_score, competition_score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [item.category, 'mmo', item.title, item.category, JSON.stringify(item), item.trend_score, item.monetization_score, item.competition_score]
            );
        }
        await emitSystemLog('AI Research legacy refresh completed', 'success', { page, target_date: targetDate, inserted_rows: normalized.length });
        return { page, count: normalized.length, data: normalized, use_lite: useLite };
    }

    if (page === 'ai_tools') {
        const normalized = validItems.map(normalizeAiToolItem);
        const deleted = await db.query(
            `DELETE FROM research_results WHERE page_type = $1 AND ${localDateSql('created_at')} = $2`,
            ['ai_tools', targetDate]
        );
        await emitSystemLog('AI Research old rows cleared for target date', 'info', {
            page,
            target_date: targetDate,
            deleted_rows: deleted.rowCount
        });
        for (const item of normalized) {
            await db.query(
                `INSERT INTO research_results
                 (topic, page_type, title, category, data, trend_score, monetization_score, competition_score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [item.tool_type, 'ai_tools', item.tool_name, item.tool_type, JSON.stringify(item), item.value_score, item.confidence_score, 0]
            );
        }
        await emitSystemLog('AI Research legacy refresh completed', 'success', { page, target_date: targetDate, inserted_rows: normalized.length });
        return { page, count: normalized.length, data: normalized, use_lite: useLite };
    }

    const normalized = validItems.map(normalizeSuggestionItem);
    const deleted = await db.query(
        `DELETE FROM ai_suggestions WHERE ${localDateSql('created_at')} = $1`,
        [targetDate]
    );
    await emitSystemLog('AI Research old rows cleared for target date', 'info', {
        page,
        target_date: targetDate,
        deleted_rows: deleted.rowCount
    });
    for (const item of normalized) {
        await db.query(
            `INSERT INTO ai_suggestions
             (recommendation_title, recommendation_text, confidence_score, urgency_score, roi_score, reasoning_summary, next_action, topic, raw_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [item.recommendation_title, item.recommendation_text, item.confidence_score, item.urgency_score, item.roi_score, item.reasoning_summary, item.next_action, item.topic, JSON.stringify(item)]
        );
    }
    await emitSystemLog('AI Research legacy refresh completed', 'success', { page, target_date: targetDate, inserted_rows: normalized.length });
    return { page, count: normalized.length, data: normalized, use_lite: useLite };
}

// â”€â”€â”€ Láº¥y danh sÃ¡ch Trend â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.get('/', async (req, res) => {
    try {
        const market = req.query.market || 'vn';
        const categoriesStr = req.query.categories || 'all';
        const categories = parseCategories(categoriesStr);
        const limit = clampResearchLimit(req.query.limit);
        const window = normalizeWindow(req.query.window || 'last_7_days');
        const mode = req.query.mode || 'overview';
        const page = parseInt(req.query.page || '1', 10);
        const requestedDate = req.query.date || null;
        const forceFresh = req.query.forceFresh === 'true' || req.query.refresh === 'true';
        const today = currentLocalDate();

        const dateInfo = await resolveProductTrendDate({ requestedDate, market, categories, window });
        let resolvedDate = dateInfo.resolvedDate;
        const shouldGenerateToday = forceFresh && (!requestedDate || requestedDate === today);
        const shouldReadByDate = !shouldGenerateToday && (requestedDate || (!forceFresh && resolvedDate));

        let result;
        if (shouldReadByDate) {
            await emitSystemLog('Product Trends read from DB by date', 'info', {
                requested_date: requestedDate,
                resolved_date: resolvedDate,
                window
            });
            const data = await loadProductTrendRows({ market, categories, window, limit, date: resolvedDate });
            result = { data, is_stale: false, schema_version: 'V4.0.1', from_db_date: resolvedDate };
        } else {
            const generationCategories = isAllCategories(categories)
                ? ['Skincare', 'Gia dụng', 'Fitness', 'Thời trang', 'Mẹ & bé', 'Điện tử', 'Sức khỏe', 'Thú cưng', 'Đồ chơi', 'Nhà cửa']
                : categories;
            await emitSystemLog('Product Trends force refresh started', 'info', {
                requested_date: requestedDate || null,
                target_date: today,
                market,
                window,
                categories: generationCategories.length
            });
            result = await getProductTrends({ market, categories: generationCategories, limit, window, mode, forceFresh: forceFresh || !resolvedDate });
            resolvedDate = today;
            await emitSystemLog('Product Trends force refresh completed', 'success', {
                target_date: today,
                window,
                count: result.data.length
            });
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

// â”€â”€â”€ Legacy Pages (Backward Compatibility) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

// â”€â”€â”€ Quota & Usage â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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
        const [
            validMmoDates,
            validAiDates,
            validSuggestionDates
        ] = await Promise.all([
            getValidLegacyDateRows('mmo', legacyRes.rows.filter(row => row.page_type === 'mmo')),
            getValidLegacyDateRows('ai_tools', legacyRes.rows.filter(row => row.page_type === 'ai_tools')),
            getValidLegacyDateRows('suggestions', suggestionsRes.rows)
        ]);
        validMmoDates.forEach(row => addCount('mmo', row.day, row.count));
        validAiDates.forEach(row => addCount('ai_market', row.day, row.count));
        validSuggestionDates.forEach(row => addCount('suggestions', row.day, row.count));

        const windowsByDate = {};
        for (const row of trendsRes.rows) {
            const window = normalizeWindow(row.source_window || 'last_7_days');
            const rows = await loadProductTrendRows({
                market: 'vn',
                categories: ['all'],
                window,
                limit: DEFAULT_RESEARCH_RESULTS,
                date: row.day
            });
            if (rows.length < MIN_RESEARCH_RESULTS) continue;
            addCount('trends_v4', row.day, rows.length);
            if (!windowsByDate[row.day]) windowsByDate[row.day] = {};
            windowsByDate[row.day][window] = rows.length;
        }
        affRes.rows.forEach(row => addCount('aff_vid', row.day, row.count));
        upPostRes.rows.forEach(row => addCount('up_post', row.day, row.count));

        const allDays = new Set();
        Object.values(pages).forEach(map => Object.keys(map).forEach(day => allDays.add(day)));
        const availableDates = Array.from(allDays).sort().reverse();

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

// â”€â”€â”€ Prompt Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function ensureResearchPromptTitleColumn() {
    await db.query('ALTER TABLE research_prompts ADD COLUMN IF NOT EXISTS title TEXT');
    await db.query(`
        UPDATE research_prompts
        SET title = CASE page_type
            WHEN 'overview' THEN 'Product Trend Overview'
            WHEN 'deep_dive' THEN 'Product Deep Dive'
            WHEN 'opportunity' THEN 'Product Opportunity Plan'
            WHEN 'mmo' THEN 'MMO Opportunity Research'
            WHEN 'ai_tools' THEN 'AI Tools Market Research'
            WHEN 'suggestions' THEN 'AI Research Suggestions'
            WHEN 'aff_vid' THEN 'Video Script Studio'
            WHEN 'up_post' THEN 'Social Post Composer'
            WHEN 'test' THEN 'Gemini API Test Prompt'
            ELSE INITCAP(REPLACE(page_type, '_', ' '))
        END
        WHERE title IS NULL OR title = ''
    `);
}

router.get('/prompts', async (req, res) => {
    try {
        await ensureResearchPromptTitleColumn();
        const result = await db.query('SELECT * FROM research_prompts ORDER BY page_type, is_active DESC, updated_at DESC');
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/prompts', async (req, res) => {
    try {
        await ensureResearchPromptTitleColumn();
        const { id, page_type, variant_name, prompt_text, set_active } = req.body;
        const title = String(req.body.title || '').trim() || null;
        if (id) {
            await db.query(
                'UPDATE research_prompts SET page_type=$1, variant_name=$2, title=$3, prompt_text=$4, updated_at=NOW() WHERE id=$5',
                [page_type, variant_name, title, prompt_text, id]
            );
            if (set_active) {
                await db.query('UPDATE research_prompts SET is_active=FALSE WHERE page_type=$1', [page_type]);
                await db.query('UPDATE research_prompts SET is_active=TRUE WHERE id=$1', [id]);
            }
            res.json({ success: true, message: 'Updated' });
        } else {
            const insRes = await db.query(
                'INSERT INTO research_prompts (page_type, variant_name, title, prompt_text, is_active) VALUES ($1, $2, $3, $4, $5) RETURNING id',
                [page_type, variant_name, title, prompt_text, !!set_active]
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

// â”€â”€â”€ Gemini Testing â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/test-gemini', async (req, res) => {
    try {
        const testPrompt = "Return a JSON object with a 'status' field set to 'ok' and a 'message' field saying 'Gemini is working'.";
        const result = await callGemini(testPrompt, { endpoint: 'test', useLite: !!req.body.useLite });
        res.json({ success: true, data: result, use_lite: !!req.body.useLite });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// â”€â”€â”€ Láº¥y chi tiáº¿t 1 sáº£n pháº©m â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// AFF VID: biáº¿n káº¿t quáº£ research thÃ nh káº¿ hoáº¡ch video affiliate cÃ³ cáº¥u trÃºc.
router.get('/aff-vid/source-products', async (req, res) => {
    try {
        await ensureAffVideoTable();
        const { market = 'vn', limit = DEFAULT_RESEARCH_RESULTS } = req.query;
        const requestedDate = req.query.date || null;
        const window = normalizeWindow(req.query.window || 'last_7_days');
        const categories = parseCategories(req.query.categories || 'all');
        const dateInfo = await resolveProductTrendDate({ requestedDate, market, categories, window });
        const resolvedDate = dateInfo.resolvedDate;
        const candidates = await loadAffVideoCandidates({
            date: resolvedDate,
            market,
            window,
            categories,
            limit: clampResearchLimit(limit)
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
        const { product_id, status } = req.query;
        const params = [];
        const where = [];
        if (product_id) {
            params.push(product_id);
            where.push(`product_id = $${params.length}`);
        }
        if (status) {
            if (!AFF_VID_STATUSES.includes(status)) {
                return res.status(400).json({ success: false, error: `Invalid status: ${status}` });
            }
            params.push(status);
            where.push(`status = $${params.length}`);
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
            tone = 'review thá»±c táº¿',
            cta_type = 'affiliate_click',
            creator_persona = 'reviewer tiáº¿ng Viá»‡t',
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

// UP POST: biáº¿n AFF VID/research content thÃ nh post variants theo tá»«ng ná»n táº£ng.
router.get('/up-post/sources', async (req, res) => {
    try {
        const requestedDate = req.query.date || null;
        const sourceType = req.query.source_type || 'aff_vid';
        const dates = await upPostService.getUpPostAvailableDates(sourceType);
        const resolvedDate = requestedDate || dates[0]?.day || null;
        const sources = await upPostService.loadUpPostSources({
            limit: clampResearchLimit(req.query.limit),
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
        const data = await upPostService.listUpPostVariants({
            status: req.query.status || null,
            platform: req.query.platform || null,
            sourceContentId: req.query.source_content_id || null,
            campaignTag: req.query.campaign_tag || null,
            date: req.query.date || null,
            limit: clampResearchLimit(req.query.limit)
        });
        res.json({ success: true, data });
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
            tone = 'rÃµ rÃ ng, cÃ³ CTA',
            cta_type = 'engagement_or_click'
        } = req.body || {};
        if (!source_content_id) {
            return res.status(400).json({ success: false, error: 'source_content_id is required.' });
        }
        const result = await upPostService.generateUpPosts({
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
        const { post_ids = [] } = req.body || {};
        const data = await upPostService.enqueueUpPostVariants(post_ids);
        res.json({ success: true, data });
    } catch (err) {
        res.status(err.status || 500).json({ success: false, error: err.message });
    }
});

// ─── AFF VID: cập nhật status kế hoạch video ──────────────────────────────
// PATCH /api/research/aff-vid/plans/:id/status
// Body: { status, notes? }
// Statuses: draft | rendering | rendered | posting | posted | failed
router.post('/aff-vid/plans/:id/enqueue', async (req, res) => {
    try {
        await ensureAffVideoTable();
        const { id } = req.params;
        const existing = await db.query(`SELECT id, status FROM aff_video_plans WHERE id::TEXT = $1`, [String(id)]);
        if (!existing.rows.length) {
            return res.status(404).json({ success: false, error: `Plan id=${id} not found.` });
        }
        await addAffVidJob(id, req.body || {});
        await db.query(
            `UPDATE aff_video_plans
             SET status = CASE WHEN status IN ('draft', 'failed', 'posted') THEN 'rendering' ELSE status END,
                 plan_data = COALESCE(plan_data, '{}'::jsonb) || jsonb_build_object('queued_at', NOW()::text),
                 updated_at = NOW()
             WHERE id::TEXT = $1`,
            [String(id)]
        );
        await emitSystemLog('AFF VID render/post job queued', 'info', { plan_id: id });
        res.json({ success: true, data: { id, status: 'queued' } });
    } catch (err) {
        await emitSystemLog('AFF VID enqueue failed', 'error', { plan_id: req.params.id, error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

router.patch('/aff-vid/plans/:id/status', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, notes } = req.body || {};
        if (!status || !AFF_VID_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Invalid status. Must be one of: ${AFF_VID_STATUSES.join(', ')}`
            });
        }
        const result = await db.query(
            `UPDATE aff_video_plans
             SET status = $1,
                 plan_data = plan_data || jsonb_build_object('status_notes', $2::text, 'status_updated_at', NOW()::text),
                 updated_at = NOW()
             WHERE id = $3
             RETURNING id, product_id, status, updated_at`,
            [status, notes || null, id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Plan id=${id} not found.` });
        }
        await emitSystemLog(`AFF VID plan ${id} status → ${status}`, 'info', { plan_id: id, status, notes });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await emitSystemLog(`AFF VID status update failed`, 'error', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});

// PATCH /api/research/aff-vid/plans/:id
// Body: { status?, platform_targets?, plan_data? } — generic plan patch
router.patch('/aff-vid/plans/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const { status, platform_targets, plan_data } = req.body || {};
        const updates = [];
        const params = [];
        if (status) {
            if (!AFF_VID_STATUSES.includes(status)) {
                return res.status(400).json({ success: false, error: `Invalid status: ${status}` });
            }
            params.push(status);
            updates.push(`status = $${params.length}`);
        }
        if (platform_targets) {
            params.push(JSON.stringify(platform_targets));
            updates.push(`platform_targets = $${params.length}`);
        }
        if (plan_data) {
            params.push(JSON.stringify(plan_data));
            updates.push(`plan_data = $${params.length}`);
        }
        if (updates.length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update.' });
        }
        updates.push(`updated_at = NOW()`);
        params.push(id);
        const result = await db.query(
            `UPDATE aff_video_plans SET ${updates.join(', ')} WHERE id = $${params.length} RETURNING *`,
            params
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Plan id=${id} not found.` });
        }
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── UP POST: publisher result update ─────────────────────────────────────
// PATCH /api/research/up-post/variants/:post_id
// Body: { status, published_url?, published_at?, failed_reason?, retry_count? }
router.patch('/up-post/variants/:post_id', async (req, res) => {
    try {
        const { post_id } = req.params;
        const { status, published_url, published_at, failed_reason } = req.body || {};
        if (!status || !UP_POST_PATCH_STATUSES.includes(status)) {
            return res.status(400).json({
                success: false,
                error: `Invalid status. Must be one of: ${UP_POST_PATCH_STATUSES.join(', ')}`
            });
        }
        const updates = ['status = $1', 'updated_at = NOW()'];
        const params = [status];
        if (published_url) {
            params.push(published_url);
            updates.push(`post_data = jsonb_set(COALESCE(post_data, '{}'), '{published_url}', to_jsonb($${params.length}::text))`);
        }
        if (published_at) {
            params.push(published_at);
            updates.push(`published_at = $${params.length}`);
        } else if (status === 'published') {
            updates.push(`published_at = NOW()`);
        }
        if (failed_reason) {
            params.push(failed_reason);
            updates.push(`failed_reason = $${params.length}`);
        }
        params.push(post_id);
        const result = await db.query(
            `UPDATE up_post_variants SET ${updates.join(', ')} WHERE post_id = $${params.length} RETURNING post_id, platform, status, published_at, failed_reason, updated_at`,
            params
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ success: false, error: `Variant post_id=${post_id} not found.` });
        }
        await emitSystemLog(`UP POST ${post_id} status → ${status}`, 'info', { post_id, status, published_url });
        res.json({ success: true, data: result.rows[0] });
    } catch (err) {
        await emitSystemLog(`UP POST variant update failed`, 'error', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});


router.get('/prompt-options', async (req, res) => {
    res.json({
        success: true,
        data: {
            scenarios: [
                { id: 'studio', label: 'Professional Studio', description: 'Clean background with carefully arranged lighting' },
                { id: 'lifestyle', label: 'Lifestyle', description: 'Cafe, street, home, or everyday context' },
                { id: 'nature', label: 'Nature', description: 'Forest, beach, mountain, or outdoor environment' },
                { id: 'cyberpunk', label: 'Cyberpunk', description: 'Neon, futuristic, tech-forward setting' },
                { id: 'abstract', label: 'Abstract', description: 'Shapes, colors, and expressive visual composition' }
            ],
            characters: [
                { id: 'none', label: 'No person', description: 'Product-only composition' },
                { id: 'model_f', label: 'Female model', description: 'Asian commercial model' },
                { id: 'model_m', label: 'Male model', description: 'Asian commercial model' },
                { id: 'hand', label: 'Handheld product', description: 'Product held in hand' }
            ],
            moods: [
                { id: 'bright', label: 'Bright' },
                { id: 'dark_mystery', label: 'Dark / mysterious' },
                { id: 'warm', label: 'Warm' },
                { id: 'cool', label: 'Cool' },
                { id: 'dreamy', label: 'Dreamy' },
                { id: 'luxury', label: 'Luxury' },
                { id: 'energetic', label: 'Energetic' },
                { id: 'minimal', label: 'Minimal' }
            ],
            styles: [
                { id: 'photorealistic', label: 'Photorealistic' },
                { id: 'cinematic', label: 'Cinematic' },
                { id: 'anime', label: 'Anime' },
                { id: '3d_render', label: '3D Render' },
                { id: 'illustration', label: 'Illustration' },
                { id: 'oil_painting', label: 'Oil Painting' },
                { id: 'watercolor', label: 'Watercolor' }
            ]
        }
    });
});

router.post('/generate-prompt', async (req, res) => {
    try {
        const payload = req.body || {};
        const promptTemplate = [
            'You are a professional image and video prompt engineer.',
            'Create a JSON object with exactly two string fields: positive_prompt and negative_prompt.',
            'Base the prompt on these selections:',
            JSON.stringify(payload)
        ].join('\n');
        const raw = await callGemini(promptTemplate, { endpoint: 'prompt_builder', useLite: false, skipCache: true });
        if (!raw) return res.status(500).json({ success: false, error: 'Gemini returned empty' });
        let parsed = raw && typeof raw === 'object' ? extractObject(raw) : null;
        if (!parsed?.positive_prompt) {
            const text = typeof raw === 'string' ? raw : String(raw?.raw || '');
            const match = text.match(/\{[\s\S]*?\}/);
            parsed = match ? JSON.parse(match[0]) : { positive_prompt: text || JSON.stringify(raw), negative_prompt: 'Low quality, worst quality, text, watermark' };
        }
        const prompt = [
            `Positive prompt:\n${parsed.positive_prompt || ''}`,
            `Negative prompt:\n${parsed.negative_prompt || 'Low quality, worst quality, text, watermark'}`
        ].join('\n\n');
        res.json({ success: true, data: { prompt, raw: parsed } });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

router.post('/generate-media', async (req, res) => {
    const payload = req.body || {};
    const mediaType = payload.media_type === 'video' ? 'video' : 'image';
    const aspectRatio = payload.aspect_ratio || '9:16';
    const quality = payload.quality || 'premium';
    res.json({
        success: true,
        data: {
            status: 'mockup',
            media_type: mediaType,
            image_url: 'https://placehold.co/600x800/222222/6366f1?text=Media+Generated',
            title: mediaType === 'video' ? 'Video Storyboard Mockup' : 'Image Mockup',
            aspect_ratio: aspectRatio,
            quality,
            description: 'Mockup response. Replace this endpoint with the production AI media provider.'
        }
    });
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

// â”€â”€â”€ Refresh thá»§ cÃ´ng â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
router.post('/refresh', async (req, res) => {
    try {
        const targetDate = req.body.target_date || currentLocalDate();
        const { page, market = 'vn', categories = ['Skincare', 'Gia dụng'], source_window = 'last_7_days', mode = 'overview' } = req.body;
        await emitSystemLog('Manual AI Research refresh requested', 'info', {
            page: page || 'trends',
            target_date: targetDate,
            source_window
        });

        if (page === 'trends' || !page) {
            if (targetDate !== currentLocalDate()) {
                return res.status(400).json({
                    success: false,
                    error: `Manual refresh only supports today's date (${currentLocalDate()}). Selected date: ${targetDate}.`
                });
            }
            const result = await getProductTrends({ market, categories, window: source_window, mode, limit: DEFAULT_RESEARCH_RESULTS, forceFresh: true, useLite: !!req.body.useLite });
            await emitSystemLog('Manual Product Trends refresh completed', 'success', {
                target_date: targetDate,
                count: result.data.length,
                source_window
            });
            return res.json({ success: true, message: 'Refreshed trends successfully.', count: result.data.length, use_lite: !!req.body.useLite, target_date: targetDate });
        }

        const result = await refreshLegacyResearchPageService(page, { source_window, useLite: req.body.useLite, target_date: targetDate });
        res.json({
            success: true,
            message: `Refreshed ${page} successfully.`,
            count: result.count,
            use_lite: result.use_lite,
            target_date: targetDate
        });
    } catch (err) {
        await emitSystemLog('Manual AI Research refresh failed', 'error', { error: err.message });
        res.status(500).json({ success: false, error: err.message });
    }
});
// â”€â”€â”€ Thao tÃ¡c quáº£n trá»‹ ná»™i bá»™ â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

router.post('/admin/run-daily-job', async (req, res) => {
    const { researchQueue } = require('./queue');
    const date = currentLocalDate();
    await researchQueue.add('manual-research', { trigger: 'manual-admin', target_date: date }, {
        jobId: `trend_manual_${date}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5 * 60 * 1000 },
        removeOnComplete: true,
        removeOnFail: false
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
