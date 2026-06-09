/**
 * Product Trend Research Service V4.0.1
 */
const db = require('./db');
const { callGemini, incrementCacheHit, getQuota } = require('./gemini');
const { fetchMarketSnapshot, formatSnapshotForPrompt } = require('./market-data');
const { emitSystemLog } = require('./logger');
const crypto = require('crypto');
const RESEARCH_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Ho_Chi_Minh';

const DEFAULT_CATEGORIES = ['Skincare', 'Gia dụng', 'Fitness', 'Thời trang', 'Mẹ & bé', 'Điện tử', 'Sức khỏe', 'Thú cưng', 'Đồ chơi', 'Nhà cửa'];
const inFlight = new Map();
const MIN_RESEARCH_RESULTS = 4;
const MAX_RESEARCH_RESULTS = 15;
const DEFAULT_RESEARCH_RESULTS = 15;
const AI_MARKET_MIN_RESULTS = 4;
const AI_MARKET_MAX_RESULTS = 8;
const DEFAULT_AI_MARKET_RESULTS = 8;
const TREND_WINDOWS = {
    today: 'trong ngày hôm nay, ưu tiên tín hiệu mới nhất trong 24 giờ qua',
    last_3_days: 'trong 3 ngày gần nhất, ưu tiên tín hiệu tăng tốc ngắn hạn',
    last_7_days: 'trong 7 ngày gần nhất, ưu tiên xu hướng bền hơn trong tuần'
};

function buildAiToolsRetryPrompt({ currentDate, sourceWindow, limit }) {
    const boundedLimit = clampResearchLimit(limit, DEFAULT_AI_MARKET_RESULTS, AI_MARKET_MAX_RESULTS, AI_MARKET_MIN_RESULTS);
    return `Return valid RFC8259 JSON array only. No markdown. No explanation.
Current date: ${currentDate}.
Task: find ${AI_MARKET_MIN_RESULTS} to ${boundedLimit} AI tools, AI projects, or AI platforms that are popular, fast-rising, newly launched, newly updated, newly discounted, or strategically useful in the current week ending ${currentDate}.
Freshness: use only source evidence dated inside ${sourceWindow} relative to ${currentDate}. For last_7_days, source_date must be inside the last 7 days. Do not include evergreen old brands unless there is fresh dated evidence and a clear "why now" trigger.
Required research workflow:
- Start with GitHub Trending daily at https://github.com/trending?since=daily&spoken_language_code= for developer/open-source AI tools, then check fast-growing repo releases, stars/forks only when visible, and official repo release notes.
- Cross-check with at least 3 independent source classes when available: Reddit discussions, X/Twitter posts or indexed discussions, Hacker News, Product Hunt, official changelog/blog/forum, vendor/community Discord/forum pages that are publicly accessible, credible tech press, reputable newsletters, pricing/deal pages, and creator demos.
- Do not rely on only one generic source class for the whole list. Diversify the final ranking across source classes and AI categories.
- Prefer primary/near-primary evidence: official changelog/release page, GitHub repo/release, Product Hunt launch, HN thread, Reddit thread, official forum/community thread, or reputable tech press article.
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

SERVER-ENFORCED FRESHNESS AND SOURCE CONTRACT:
- Current date: ${currentDate}.
- Requested source_window: ${sourceWindow}.
- Return ${MIN_RESEARCH_RESULTS}-${boundedLimit} ranked results. Prefer ${boundedLimit} when evidence is strong enough.
- Use only evidence whose source_date is inside ${sourceWindow} relative to ${currentDate}.
- Daily repeats are allowed, but only when evidence_summary/freshness_note explains the fresh signal inside ${sourceWindow}.
- Reject old evergreen items unless they have a fresh trigger: major update, newly viral content, marketplace rank movement, fresh creator/community discussion, current discount, new integration/model support, or renewed search demand.
- Use multiple source classes when available: TikTok/TikTok Shop, Shopee/Lazada/Amazon, Google Trends/search intent, YouTube Shorts, Reddit, X/Twitter, Facebook Groups, Product Hunt, Hacker News, GitHub Trending, official changelogs/blogs, newsletters, and niche communities.
- For code/open-source/developer tools, check GitHub Trending daily exactly at https://github.com/trending?since=daily&spoken_language_code= when relevant.
- Every item must include source_url, source_date, evidence_summary, source_window.
- source_window must equal "${sourceWindow}".
- confidence_score must be below 70 when the evidence is missing, stale, generic, or unverifiable.
- Optimize for currently popular, actively discussed, or fast-rising items. Famous but stale items must be removed.
- Each item must include a clear "why now" signal in evidence_summary, market_signal, freshness_note, popularity_signal, or recent_trigger.
- This page is "${page}". Keep all user-facing prose in natural Vietnamese only.`;
}

const LEGACY_PAGE_CONFIG = {
    mmo: {
        promptType: 'mmo',
        listKeys: ['items', 'opportunities', 'data', 'results'],
        required: ['title', 'category', 'trend_score', 'monetization_score', 'competition_score'],
        defaultTopics: ['affiliate TikTok Shop', 'digital product', 'AI automation service', 'print on demand', 'content niche'],
        limit: DEFAULT_RESEARCH_RESULTS
    },
    ai_tools: {
        promptType: 'ai_tools',
        listKeys: ['items', 'tools', 'ai_tools', 'tool_list', 'tools_list', 'data', 'results'],
        required: ['tool_name', 'tool_type', 'use_case'],
        defaultTopics: ['AI tools', 'GitHub trending', 'coding assistants', 'agent AI', 'automation tools', 'open-source AI', 'AI video', 'AI data tools'],
        minResults: AI_MARKET_MIN_RESULTS,
        limit: DEFAULT_AI_MARKET_RESULTS
    },
    suggestions: {
        promptType: 'suggestions',
        listKeys: ['items', 'suggestions', 'recommendations', 'data', 'results'],
        required: ['recommendation_title'],
        defaultTopics: ['AI tools', 'MMO opportunities', 'weekly market signals', 'automation workflows'],
        limit: DEFAULT_RESEARCH_RESULTS
    }
};

function clampResearchLimit(value, fallback = DEFAULT_RESEARCH_RESULTS, max = MAX_RESEARCH_RESULTS, min = MIN_RESEARCH_RESULTS) {
    const n = parseInt(value, 10);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(min, Math.min(max, n));
}

function minResultsForPage(page) {
    return LEGACY_PAGE_CONFIG[page]?.minResults || MIN_RESEARCH_RESULTS;
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

function localDateSql(column = 'created_at') {
    return `DATE(${column} AT TIME ZONE '${RESEARCH_TIMEZONE}')`;
}

function productDateSql(column = 'created_at') {
    return `DATE(${column})`;
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

const VIETNAMESE_OUTPUT_INSTRUCTION = `

YÊU CẦU NGÔN NGỮ BẮT BUỘC:
- Tất cả nội dung trả về PHẢI là tiếng Việt thuần túy.
- KHÔNG sử dụng định dạng "Tiếng Việt (English)".
- Chỉ giữ lại tên riêng của công cụ, thương hiệu hoặc thuật ngữ kỹ thuật không thể dịch (ví dụ: AI, ChatGPT, TikTok).
- Các trường như: title, summary, content_angle, traffic_source, monetization_model, use_case, market_signal, market_reason, best_value_reason, recommendation_title, recommendation_text, reasoning_summary, next_action PHẢI viết bằng tiếng Việt tự nhiên, chuyên nghiệp.
`;

function normalizeTrendWindow(value) {
    if (value === 'last_24h' || value === '24h' || value === 'today') return 'today';
    if (value === '3_days' || value === 'last_3_days') return 'last_3_days';
    if (value === '7_days' || value === 'last_7_days') return 'last_7_days';
    return 'last_7_days';
}

function windowProductId(productId, window, date = currentLocalDate()) {
    const base = String(productId || 'product')
        .replace(/__\d{4}_\d{2}_\d{2}__(today|last_3_days|last_7_days)$/g, '')
        .replace(/__(today|last_3_days|last_7_days)$/g, '');
    const dateKey = String(date || currentLocalDate()).replace(/-/g, '_');
    return `${base}__${dateKey}__${window}`;
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

function shouldUseLiteForPage(page, quota, explicitValue) {
    if (explicitValue !== undefined) return !!explicitValue;
    return page === 'suggestions' ? shouldUseLite(quota) : false;
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

function hasAnyField(item, fields) {
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

const sourceVerificationCache = new Map();

function itemSourceUrls(item = {}) {
    const sources = Array.isArray(item.supporting_sources) ? item.supporting_sources : [];
    return normalizeEvidenceList([
        item.source_url,
        item.url,
        item.launch_url,
        item.github_url,
        ...(Array.isArray(item.source_urls) ? item.source_urls : []),
        ...sources.map(source => typeof source === 'string'
            ? source
            : source?.url || source?.source_url || source?.href)
    ]).filter(value => /^https?:\/\//i.test(value));
}

function snapshotSourceIndex(snapshot) {
    const urls = new Map();
    Object.values(snapshot?.sources || {}).forEach(items => {
        (Array.isArray(items) ? items : []).forEach(item => {
            if (item?.url) urls.set(String(item.url), item.name || item.keyword || '');
        });
    });
    return urls;
}

function meaningfulWords(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .match(/[a-z0-9]{4,}/g) || [];
}

async function verifySourceUrl(url, itemName) {
    const cacheKey = `${url}|${itemName}`;
    if (sourceVerificationCache.has(cacheKey)) return sourceVerificationCache.get(cacheKey);
    const verification = (async () => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        try {
            const response = await fetch(url, {
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'user-agent': 'Mozilla/5.0' }
            });
            if (response.status < 200 || response.status >= 400) return false;
            const html = (await response.text()).slice(0, 200000);
            const title = (html.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim();
            if (!title || /page not found|404 error|coming soon|không còn tồn tại|not found/i.test(title)) return false;

            const original = new URL(url);
            const finalUrl = new URL(response.url);
            if (original.hostname !== finalUrl.hostname) return false;
            if (original.pathname !== finalUrl.pathname) {
                const originalIds = original.pathname.match(/\d{5,}/g) || [];
                const finalIds = finalUrl.pathname.match(/\d{5,}/g) || [];
                if (!originalIds.some(id => finalIds.includes(id))) return false;
            }

            const titleWords = new Set(meaningfulWords(title));
            return meaningfulWords(itemName).some(word => titleWords.has(word));
        } catch (err) {
            return false;
        } finally {
            clearTimeout(timeout);
        }
    })();
    sourceVerificationCache.set(cacheKey, verification);
    return verification;
}

async function verifyResearchItems(items, { page, marketSnapshot } = {}) {
    const trustedSnapshotUrls = snapshotSourceIndex(marketSnapshot);
    const verified = [];
    for (const item of items) {
        const urls = itemSourceUrls(item);
        const itemName = resultName(page, item);
        let accepted = urls.some(url => {
            const snapshotName = trustedSnapshotUrls.get(url);
            if (!snapshotName) return false;
            if (page === 'suggestions') return true;
            const snapshotWords = new Set(meaningfulWords(snapshotName));
            return meaningfulWords(itemName).some(word => snapshotWords.has(word));
        });
        for (const url of urls) {
            if (accepted) break;
            accepted = await verifySourceUrl(url, itemName);
        }
        if (accepted) verified.push(item);
    }
    await emitSystemLog('AI Research source URLs verified', 'info', {
        page,
        input_items: items.length,
        verified_items: verified.length,
        rejected_items: items.length - verified.length
    });
    return verified;
}

function normalizeProductTrendItem(item, index, window) {
    const productName = item.product_name || item.name || item.title || item.product || `Product trend ${index + 1}`;
    const sourceUrls = normalizeEvidenceList(item.source_urls || item.sources || item.urls || item.source_url || item.url);
    const sourceDates = normalizeEvidenceList(item.source_dates || item.published_dates || item.source_date || item.published_at || item.updated_at || item.release_date);
    return {
        ...item,
        id: item.id || slug(productName, `trend_${index + 1}`),
        category: item.category || item.niche || item.topic || 'Other',
        product_name: productName,
        trend_score: score(item.trend_score || item.score, 70),
        confidence_score: confidenceScore(item.confidence_score, 70),
        summary: item.summary || item.description || item.market_reason || item.evidence_summary || '',
        source_urls: sourceUrls,
        source_dates: sourceDates,
        evidence_summary: item.evidence_summary || item.evidence || item.market_signal || item.market_reason || '',
        popularity_signal: item.popularity_signal || item.market_signal || item.search_intent || '',
        recent_trigger: item.recent_trigger || item.evidence_summary || item.market_signal || '',
        source_window: normalizeTrendWindow(item.source_window || window)
    };
}

function snapshotDate(snapshot) {
    return new Date(snapshot?.fetched_at || Date.now()).toISOString().slice(0, 10);
}

function flattenSnapshotSourceItems(snapshot) {
    const items = [];
    Object.entries(snapshot?.sources || {}).forEach(([sourceName, list]) => {
        (Array.isArray(list) ? list : []).forEach(item => {
            const name = item?.name || item?.keyword || item?.title;
            const url = item?.url;
            if (!name || !/^https?:\/\//i.test(String(url || ''))) return;
            items.push({ ...item, name, url, sourceName });
        });
    });
    return items;
}

function evidenceForSnapshotItem(item, sourceDate) {
    const signal = [
        `Nguồn thật ${item.sourceName || item.source || 'market_snapshot'} được fetch ngày ${sourceDate}.`,
        item.traffic ? `Google Trends ghi nhận khoảng ${item.traffic} lượt quan tâm.` : '',
        item.sold || item.sold_text || item.sold_count ? `Marketplace có tín hiệu bán/chạy: ${item.sold || item.sold_text || item.sold_count}.` : '',
        item.rating || item.review_count ? `Có tín hiệu đánh giá/review: ${item.rating || item.review_count}.` : '',
        item.description ? `Mô tả nguồn: ${item.description}.` : '',
        item.stars_text ? `GitHub Trending ghi nhận ${item.stars_text}.` : ''
    ].filter(Boolean).join(' ');
    return signal.length >= 90 ? signal : `${signal} Đây là candidate source-first, dùng URL chính xác từ snapshot và không suy đoán thêm nguồn ngoài.`;
}

function productSeedFromSnapshot(snapshot, window, limit) {
    const sourceDate = snapshotDate(snapshot);
    return flattenSnapshotSourceItems(snapshot)
        .filter(item => !/^github_trending_ai$/i.test(item.sourceName || ''))
        .slice(0, limit)
        .map((item, index) => ({
            id: slug(item.name, `source_product_${index + 1}`),
            category: item.sourceName === 'google_trends' ? 'Search Trend' : 'Marketplace',
            product_name: item.name,
            trend_score: score(88 - index, 75),
            confidence_score: 78,
            summary: `Xu hướng được lấy trực tiếp từ ${item.sourceName || item.source}, có URL nguồn thật và tín hiệu mới trong ngày.`,
            source_url: item.url,
            source_urls: [item.url],
            source_date: sourceDate,
            source_dates: [sourceDate],
            source_window: window,
            evidence_summary: evidenceForSnapshotItem(item, sourceDate),
            popularity_signal: item.traffic || item.sold || item.sold_text || item.sold_count || item.sourceName || 'source-first snapshot',
            recent_trigger: `Nguồn snapshot cập nhật ngày ${sourceDate}.`
        }));
}

function mmoSeedFromSnapshot(snapshot, sourceWindow, limit) {
    const sourceDate = snapshotDate(snapshot);
    return flattenSnapshotSourceItems(snapshot)
        .filter(item => item.sourceName !== 'github_trending_ai')
        .slice(0, limit)
        .map((item, index) => ({
            title: `Khai thác ${item.name}`,
            category: item.sourceName === 'google_trends' ? 'Search intent' : 'Affiliate commerce',
            trend_score: score(86 - index, 72),
            monetization_score: score(82 - index, 70),
            competition_score: score(42 + index, 55),
            content_angle: `Làm nội dung giải thích/review quanh tín hiệu đang tăng của "${item.name}".`,
            traffic_source: item.sourceName === 'google_trends' ? 'Google Trends + SEO/news angle' : 'Affiliate marketplace + short video',
            monetization_model: item.sourceName === 'google_trends' ? 'lead magnet, affiliate liên quan, newsletter' : 'affiliate TikTok/Shopee/Lazada',
            market_maturity: 'growing',
            confidence_score: 78,
            summary: `Cơ hội MMO dựa trên candidate source-first từ ${item.sourceName || item.source}, không dùng URL suy đoán.`,
            source_url: item.url,
            source_date: sourceDate,
            source_urls: [item.url],
            source_dates: [sourceDate],
            source_window: sourceWindow,
            evidence_summary: evidenceForSnapshotItem(item, sourceDate),
            popularity_signal: item.traffic || item.sold || item.sold_text || item.sold_count || 'source-first snapshot',
            recent_trigger: `Nguồn snapshot cập nhật ngày ${sourceDate}.`
        }));
}

function aiToolSeedFromSnapshot(snapshot, sourceWindow, limit) {
    const sourceDate = snapshotDate(snapshot);
    return flattenSnapshotSourceItems(snapshot)
        .filter(item => item.sourceName === 'github_trending_ai')
        .slice(0, limit)
        .map((item, index) => ({
            tool_name: item.name,
            tool_type: item.language ? `open-source/${item.language}` : 'open-source AI tool',
            use_case: item.description || 'Công cụ AI/developer tool đang xuất hiện trong GitHub Trending.',
            value_score: score(88 - index, 75),
            market_signal: `GitHub Trending ${item.source || 'daily/weekly'}`,
            market_reason: `Repo nằm trong snapshot GitHub Trending AI ngày ${sourceDate}.`,
            price_level: 'open-source/free',
            discount_or_launch_status: 'open-source trending',
            confidence_score: 80,
            summary: item.description || `Repo ${item.name} đang có tín hiệu từ GitHub Trending.`,
            best_value_reason: 'Có thể kiểm tra trực tiếp mã nguồn, issue, star và README từ URL GitHub thật.',
            source_url: item.url,
            source_date: sourceDate,
            source_urls: [item.url],
            source_dates: [sourceDate],
            source_classes: ['github_trending'],
            source_window: sourceWindow,
            github_trending_url: item.url,
            evidence_summary: evidenceForSnapshotItem(item, sourceDate),
            popularity_signal: item.stars_text || 'GitHub Trending snapshot',
            recent_trigger: `Repo xuất hiện trong snapshot GitHub Trending ngày ${sourceDate}.`,
            is_best_value: true,
            is_new_noteworthy: true
        }));
}

function suggestionSeedFromRows(mmoRows, aiRows, sourceWindow, limit) {
    const sourceRows = [...mmoRows, ...aiRows].filter(Boolean);
    return sourceRows.slice(0, limit).map((item, index) => {
        const title = item.title || item.tool_name || item.product_name || item.name || `Nguồn ${index + 1}`;
        const url = firstValue(item.source_urls || item.supporting_sources || item.source_url || item.url || item.github_trending_url);
        const date = firstValue(item.source_dates || item.source_date) || currentLocalDate();
        return {
            recommendation_title: `Ưu tiên kiểm thử: ${title}`,
            recommendation_text: `Dùng nguồn đang có tín hiệu mới để tạo nội dung/test affiliate nhỏ trước, đo CTR và phản hồi trong 24-48 giờ.`,
            confidence_score: 78,
            urgency_score: score(82 - index, 70),
            roi_score: score(80 - index, 68),
            reasoning_summary: `Recommendation được tạo từ dữ liệu source-first đã lưu ngày ${date}, ưu tiên URL thật và tín hiệu mới thay vì phỏng đoán.`,
            next_action: `Tạo 1 landing/content test cho "${title}" và gắn tracking nguồn.`,
            supporting_sources: url ? [url] : [],
            source_dates: [date],
            source_window: sourceWindow,
            freshness_note: `Nguồn hỗ trợ nằm trong window ${sourceWindow}, ngày ${date}.`,
            topic: item.category || item.tool_type || 'source-first research'
        };
    }).filter(item => item.supporting_sources.length);
}

function hasFreshEvidenceFields(item, window = 'last_7_days') {
    const sourceDate = item.source_date || firstValue(item.source_dates) || item.published_at || item.updated_at || item.release_date;
    return (hasAnyField(item, ['source_url', 'url', 'launch_url', 'github_url']) || hasAnyField(item, ['source_urls']))
        && (hasAnyField(item, ['source_date', 'published_at', 'updated_at', 'release_date']) || hasAnyField(item, ['source_dates']))
        && hasAnyField(item, ['evidence_summary', 'evidence', 'market_signal', 'market_reason'])
        && isDateInsideWindow(sourceDate, window)
        && confidenceScore(item.confidence_score, 0) >= 70
        && hasQualityEvidence(item);
}

function isTransientGeminiError(err) {
    return /Gemini API (429|500|502|503|504)|UNAVAILABLE|RESOURCE_EXHAUSTED|overloaded|high demand/i.test(err?.message || '');
}

function isEmptyAiPayload(data, keys) {
    return extractList(data, keys).length === 0;
}

async function callGeminiWithFallbacks(prompt, { endpoint, useLite = false, listKeys = [], allowNoSearchRetry = true, googleSearch = undefined } = {}) {
    const attempts = [
        { useLite, googleSearch, label: googleSearch === false ? 'source_snapshot' : 'primary' },
        ...(!useLite ? [{ useLite: true, googleSearch, label: googleSearch === false ? 'lite_source_snapshot' : 'lite_grounded' }] : []),
        ...(allowNoSearchRetry ? [
            { useLite, googleSearch: false, label: 'no_search' },
            { useLite: true, googleSearch: false, label: 'lite_no_search' }
        ] : [])
    ];
    let lastError = null;
    for (const attempt of attempts) {
        try {
            await emitSystemLog('Gemini fallback attempt started', 'info', {
                endpoint,
                attempt: attempt.label,
                use_lite: attempt.useLite,
                google_search: attempt.googleSearch
            });
            const data = await callGemini(prompt, {
                endpoint,
                skipCache: true,
                useLite: attempt.useLite,
                googleSearch: attempt.googleSearch
            });
            if (listKeys.length && isEmptyAiPayload(data, listKeys) && attempt !== attempts[attempts.length - 1]) {
                await emitSystemLog('Gemini fallback attempt returned empty list', 'warning', {
                    endpoint,
                    attempt: attempt.label
                });
                continue;
            }
            return data;
        } catch (err) {
            lastError = err;
            await emitSystemLog('Gemini fallback attempt failed', 'warning', {
                endpoint,
                attempt: attempt.label,
                error: err.message
            });
            if (!isTransientGeminiError(err) && attempt.label !== 'primary') break;
        }
    }
    throw lastError || new Error(`Gemini failed for ${endpoint}.`);
}

function validateLegacyItems(page, items, requiredFields) {
    if (!Array.isArray(items)) return [];
    const itemWindow = item => normalizeTrendWindow(item.source_window || 'last_7_days');
    if (page === 'mmo') {
        return validateData(items, requiredFields).filter(item => hasFreshEvidenceFields(item, itemWindow(item)));
    }
    if (page === 'suggestions') {
        return validateData(items, requiredFields).filter(item => {
            if (!item || typeof item !== 'object') return false;
            const sources = Array.isArray(item.supporting_sources) ? item.supporting_sources.filter(Boolean) : [];
            const window = item.source_window || 'last_7_days';
            return sources.length > 0
                && hasAnyField(item, ['freshness_note', 'reasoning_summary'])
                && confidenceScore(item.confidence_score, 0) >= 70
                && hasDateInsideWindow(item.source_dates || item.source_date, window)
                && hasQualityEvidence(item);
        });
    }
    if (page !== 'ai_tools') return validateData(items, requiredFields);
    return items.filter(item => {
        if (!item || typeof item !== 'object') return false;
        return hasAnyField(item, ['tool_name', 'name', 'title'])
            && hasAnyField(item, ['tool_type', 'type', 'category'])
            && hasAnyField(item, ['use_case', 'primary_use_case', 'summary', 'description'])
            && hasFreshEvidenceFields(item, itemWindow(item));
    });
}

function filterReadableLegacyRows(page, rows) {
    const config = LEGACY_PAGE_CONFIG[page];
    if (!config) return rows;
    if (!['mmo', 'ai_tools', 'suggestions'].includes(page)) return rows;
    const filtered = validateLegacyItems(page, rows, config.required);
    if (filtered.length >= MIN_RESEARCH_RESULTS) return filtered;

    // Preserve historical DB results for fallback reads without relaxing the
    // strict validation used to accept newly generated research.
    return validateData(rows, config.required).map(item => ({
        ...item,
        is_stale: true
    }));
}

function itemIdentity(page, item = {}) {
    if (page === 'ai_tools') return slug(item.tool_name || item.name || item.title, 'ai_tool');
    if (page === 'suggestions') return slug(item.recommendation_title || item.title, 'suggestion');
    if (page === 'product_trends') return slug(item.product_name || item.id || item.title, 'product');
    return slug(item.title || item.name || item.opportunity, 'mmo');
}

function mergeDistinctItems(page, baseItems = [], extraItems = [], limit = DEFAULT_RESEARCH_RESULTS) {
    const seen = new Set();
    const output = [];
    [...baseItems, ...extraItems].forEach(item => {
        const key = itemIdentity(page, item);
        if (!key || seen.has(key)) return;
        seen.add(key);
        output.push(item);
    });
    return output.slice(0, limit);
}

function resultName(page, item = {}) {
    if (page === 'ai_tools') return item.tool_name || item.name || item.title || 'unknown tool';
    if (page === 'product_trends') return item.product_name || item.name || item.title || item.id || 'unknown product';
    if (page === 'suggestions') return item.recommendation_title || item.title || 'unknown suggestion';
    return item.title || item.name || item.opportunity || 'unknown opportunity';
}

function buildExpansionPrompt({ basePrompt, page, currentDate, sourceWindow, limit, existingItems, minResults = MIN_RESEARCH_RESULTS }) {
    const existingNames = existingItems.map(item => resultName(page, item)).filter(Boolean).slice(0, limit);
    const missing = Math.max(minResults - existingItems.length, 0);
    return `${basePrompt}

SERVER RECOVERY REQUEST:
- The previous response produced only ${existingItems.length} valid items after server-side evidence validation.
- Return a NEW JSON array with ${Math.max(missing + 4, minResults)}-${limit} ADDITIONAL DISTINCT items.
- Do NOT repeat these already accepted items: ${JSON.stringify(existingNames)}.
- Keep source_window exactly "${sourceWindow}" and current date exactly "${currentDate}".
- Every item must pass strict validation: specific non-homepage source URL, source_date inside ${sourceWindow}, concrete evidence_summary, and confidence_score >= 70.
- Do not use homepage URLs, docs landing pages, marketplace search pages, social search pages, hashtag pages, or generic listicles as evidence.
- Do not include broad generic items unless the source proves a specific launch, update, deal, rank jump, community spike, repo momentum, or viral discussion inside ${sourceWindow}.
- For AI Market, diversify across GitHub Trending daily, Reddit, X/Twitter, Hacker News, Product Hunt, official changelogs/forums, credible tech press, newsletters, and pricing/deal pages when available.
- Output JSON only.`;
}

function validateProductTrendItems(items, window) {
    return validateData(items, ['id', 'category', 'product_name', 'trend_score', 'confidence_score', 'summary'])
        .filter(item => item.confidence_score >= 70 && hasDateInsideWindow(item.source_dates, window) && hasQualityEvidence(item));
}

async function expandProductTrendResults({ basePrompt, endpoint, useLite, window, limit, bounded }) {
    let combined = bounded;
    for (let attempt = 1; attempt <= 2 && combined.length < MIN_RESEARCH_RESULTS; attempt += 1) {
        const expansionPrompt = buildExpansionPrompt({
            basePrompt,
            page: 'product_trends',
            currentDate: currentLocalDate(),
            sourceWindow: window,
            limit,
            existingItems: combined
        });
        await emitSystemLog('Product Trends expansion retry started', 'warning', {
            window,
            attempt,
            current_valid_items: combined.length
        });
        const retryData = await callGeminiWithFallbacks(expansionPrompt, {
            endpoint,
            useLite: attempt > 1 ? true : useLite,
            listKeys: ['items', 'products', 'trends', 'data'],
            allowNoSearchRetry: false,
            googleSearch: false
        });
        const retryResults = extractList(retryData, ['items', 'products', 'trends', 'data']);
        const retryNormalized = retryResults.map((item, index) => normalizeProductTrendItem(item, index, window));
        const retryValid = validateProductTrendItems(retryNormalized, window);
        combined = mergeDistinctItems('product_trends', combined, retryValid, limit);
        await emitSystemLog('Product Trends expansion retry validated', 'info', {
            window,
            attempt,
            raw_items: retryResults.length,
            valid_items: retryValid.length,
            combined_items: combined.length
        });
    }
    return combined;
}

async function expandLegacyResults({ page, basePrompt, config, variables, useLite, validItems, pageLimit }) {
    let combined = validItems;
    const minResults = minResultsForPage(page);
    for (let attempt = 1; attempt <= 2 && combined.length < minResults; attempt += 1) {
        const expansionPrompt = buildExpansionPrompt({
            basePrompt,
            page,
            currentDate: variables.CURRENT_DATE,
            sourceWindow: variables.SOURCE_WINDOW,
            limit: pageLimit,
            existingItems: combined,
            minResults
        });
        await emitSystemLog('AI Research expansion retry started', 'warning', {
            page,
            attempt,
            current_valid_items: combined.length
        });
        const retryData = await callGeminiWithFallbacks(expansionPrompt, {
            endpoint: config.promptType,
            useLite: attempt > 1 ? true : useLite,
            listKeys: config.listKeys,
            allowNoSearchRetry: false,
            googleSearch: false
        });
        const retryRaw = extractList(retryData, config.listKeys).slice(0, pageLimit);
        const retryValid = validateLegacyItems(page, retryRaw, config.required);
        combined = mergeDistinctItems(page, combined, retryValid, pageLimit);
        await emitSystemLog('AI Research expansion retry validated', 'info', {
            page,
            attempt,
            raw_items: retryRaw.length,
            valid_items: retryValid.length,
            combined_items: combined.length
        });
    }
    return combined;
}

function renderPrompt(template, variables = {}) {
    let output = template || '';
    Object.entries(variables).forEach(([key, value]) => {
        const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}}`, 'g');
        output = output.replace(pattern, String(value ?? ''));
    });
    return output;
}

async function buildMarketSnapshotPromptContext(options = {}) {
    try {
        const snapshot = options.marketSnapshot || await fetchMarketSnapshot();
        const text = formatSnapshotForPrompt(snapshot, {
            maxItemsPerSource: options.maxItemsPerSource || 8,
            categories: options.categories || []
        });
        const totalItems = snapshot?.sources
            ? Object.values(snapshot.sources).reduce((total, list) => total + (Array.isArray(list) ? list.length : 0), 0)
            : 0;
        await emitSystemLog('AI Research market snapshot injected into Gemini prompt', 'info', {
            page: options.page || 'unknown',
            total_items: totalItems,
            elapsed_ms: snapshot?.elapsed_ms || null
        });
        return `\n\n${text}\n`;
    } catch (err) {
        await emitSystemLog('AI Research market snapshot fetch failed; continuing without live data', 'warning', {
            page: options.page || 'unknown',
            error: err.message
        });
        return `\n\n=== REAL-TIME MARKET DATA ===\nLive marketplace snapshot unavailable (${err.message}). Use only verifiable dated evidence.\n=== END MARKET DATA ===\n`;
    }
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

async function getLegacyPromptText(pageType, variables = {}) {
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
    const result = await db.query(
        `SELECT * FROM research_results WHERE page_type = $1${adjustedDateWhere} ORDER BY created_at DESC`,
        params
    );
    return filterReadableLegacyRows(page, result.rows.map(row => ({ ...row, ...row.data })));
}

async function refreshLegacyResearchPage(page, options = {}) {
    const config = LEGACY_PAGE_CONFIG[page];
    if (!config) throw new Error(`Unsupported research page: ${page}.`);
    const targetDate = options.target_date || currentLocalDate();
    await emitSystemLog('AI Research service refresh started', 'info', {
        page,
        target_date: targetDate,
        source_window: options.source_window || 'last_7_days'
    });

    if (page === 'suggestions') {
        const [mmoRows, aiRows] = await Promise.all([
            loadLegacyPageRows('mmo', targetDate),
            loadLegacyPageRows('ai_tools', targetDate)
        ]);
        if (mmoRows.length === 0) await refreshLegacyResearchPage('mmo', options);
        if (aiRows.length === 0) await refreshLegacyResearchPage('ai_tools', options);
    }

    const topics = await getActiveTopics(page);
    const variables = {
        TOPICS: topics.join(', '),
        PAGE1_DATA: JSON.stringify((await loadLegacyPageRows('mmo', targetDate)).slice(0, DEFAULT_RESEARCH_RESULTS)),
        PAGE2_DATA: JSON.stringify((await loadLegacyPageRows('ai_tools', targetDate)).slice(0, DEFAULT_AI_MARKET_RESULTS)),
        SOURCE_WINDOW: options.source_window || 'last_7_days',
        CURRENT_DATE: currentLocalDate(),
        LIMIT: page === 'ai_tools'
            ? clampResearchLimit(config.limit, DEFAULT_AI_MARKET_RESULTS, AI_MARKET_MAX_RESULTS, AI_MARKET_MIN_RESULTS)
            : clampResearchLimit(config.limit)
    };

    let marketSnapshot = options.marketSnapshot || null;
    if (!marketSnapshot) {
        marketSnapshot = await fetchMarketSnapshot().catch(() => null);
    }

    let prompt = page === 'ai_tools'
        ? buildAiToolsRetryPrompt({
            currentDate: variables.CURRENT_DATE,
            sourceWindow: variables.SOURCE_WINDOW,
            limit: variables.LIMIT
        })
        : `${await getLegacyPromptText(config.promptType, variables)}${buildFreshnessAppendix({
            page,
            currentDate: variables.CURRENT_DATE,
            sourceWindow: variables.SOURCE_WINDOW,
            limit: config.limit
        })}`;
    prompt += await buildMarketSnapshotPromptContext({
        page,
        categories: topics,
        marketSnapshot
    });
    prompt += `
SOURCE-FIRST CONTRACT:
- Use only candidates and Exact URL values from REAL-TIME MARKET DATA, PAGE1_DATA, and PAGE2_DATA above.
- Do not browse, infer, synthesize, or guess source URLs.
- If a candidate has no Exact URL or supporting source URL, skip it.
- For AI tools, prefer GitHub Trending AI repos and exact GitHub URLs from the snapshot.
- For suggestions, derive supporting_sources only from PAGE1_DATA/PAGE2_DATA source_url/source_urls.`;
    const quota = await getQuota();
    const useLite = shouldUseLiteForPage(page, quota, options.useLite);
    await emitSystemLog('AI Research service Gemini call queued', 'info', { page, use_lite: useLite });
    const pageLimit = page === 'ai_tools'
        ? clampResearchLimit(config.limit, DEFAULT_AI_MARKET_RESULTS, AI_MARKET_MAX_RESULTS, AI_MARKET_MIN_RESULTS)
        : clampResearchLimit(config.limit);
    let aiData;
    let usedSourceFallback = false;
    try {
        aiData = await callGeminiWithFallbacks(prompt, {
            endpoint: config.promptType,
            useLite,
            listKeys: config.listKeys,
            allowNoSearchRetry: false,
            googleSearch: false
        });
    } catch (err) {
        let fallbackItems = [];
        if (page === 'mmo') fallbackItems = mmoSeedFromSnapshot(marketSnapshot, variables.SOURCE_WINDOW, pageLimit);
        if (page === 'ai_tools') fallbackItems = aiToolSeedFromSnapshot(marketSnapshot, variables.SOURCE_WINDOW, pageLimit);
        if (page === 'suggestions') {
            fallbackItems = suggestionSeedFromRows(
                JSON.parse(variables.PAGE1_DATA || '[]'),
                JSON.parse(variables.PAGE2_DATA || '[]'),
                variables.SOURCE_WINDOW,
                pageLimit
            );
        }
        if (!fallbackItems.length) throw err;
        aiData = { items: fallbackItems };
        usedSourceFallback = true;
        await emitSystemLog('AI Research using source-first snapshot fallback', 'warning', {
            page,
            count: fallbackItems.length,
            reason: err.message
        });
    }
    let rawItems = extractList(aiData, config.listKeys).slice(0, pageLimit);
    let validItems = validateLegacyItems(page, rawItems, config.required);
    await emitSystemLog('AI Research service response validated', 'info', {
        page,
        raw_items: rawItems.length,
        valid_items: validItems.length
    });

    if (!usedSourceFallback && page === 'ai_tools' && validItems.length === 0 && options.allowRetry !== false) {
        let retryPrompt = buildAiToolsRetryPrompt({
            currentDate: variables.CURRENT_DATE,
            sourceWindow: variables.SOURCE_WINDOW,
            limit: pageLimit
        });
        retryPrompt += await buildMarketSnapshotPromptContext({
            page,
            categories: topics,
            marketSnapshot
        });
        const retryData = await callGeminiWithFallbacks(retryPrompt, {
            endpoint: config.promptType,
            useLite: true,
            listKeys: config.listKeys,
            allowNoSearchRetry: false,
            googleSearch: false
        });
        rawItems = extractList(retryData, config.listKeys).slice(0, pageLimit);
        validItems = validateLegacyItems(page, rawItems, config.required);
    }

    const minResults = minResultsForPage(page);
    if (!usedSourceFallback && validItems.length < minResults && options.allowRetry !== false) {
        validItems = await expandLegacyResults({
            page,
            basePrompt: prompt,
            config,
            variables,
            useLite,
            validItems,
            pageLimit
        });
    }

    validItems = await verifyResearchItems(validItems, { page, marketSnapshot });

    if (validItems.length === 0) {
        throw new Error(`Gemini returned no valid ${page} items. Check active prompt schema.`);
    }
    if (validItems.length < minResults) {
        throw new Error(`Gemini returned only ${validItems.length} valid fresh ${page} items; refusing to write low-volume/low-confidence output.`);
    }

    if (page === 'mmo') {
        const normalized = validItems.map(normalizeMmoItem);
        const deleted = await db.query(
            `DELETE FROM research_results WHERE page_type = $1 AND ${localDateSql('created_at')} = $2`,
            ['mmo', targetDate]
        );
        await emitSystemLog('AI Research service old rows cleared', 'info', { page, target_date: targetDate, deleted_rows: deleted.rowCount });
        for (const item of normalized) {
            await db.query(
                `INSERT INTO research_results
                 (topic, page_type, title, category, data, trend_score, monetization_score, competition_score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [item.category, 'mmo', item.title, item.category, JSON.stringify(item), item.trend_score, item.monetization_score, item.competition_score]
            );
        }
        await emitSystemLog('AI Research service refresh completed', 'success', { page, target_date: targetDate, inserted_rows: normalized.length });
        return { page, count: normalized.length, data: normalized, use_lite: useLite };
    }

    if (page === 'ai_tools') {
        const normalized = validItems.map(normalizeAiToolItem);
        const deleted = await db.query(
            `DELETE FROM research_results WHERE page_type = $1 AND ${localDateSql('created_at')} = $2`,
            ['ai_tools', targetDate]
        );
        await emitSystemLog('AI Research service old rows cleared', 'info', { page, target_date: targetDate, deleted_rows: deleted.rowCount });
        for (const item of normalized) {
            await db.query(
                `INSERT INTO research_results
                 (topic, page_type, title, category, data, trend_score, monetization_score, competition_score)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
                [item.tool_type, 'ai_tools', item.tool_name, item.tool_type, JSON.stringify(item), item.value_score, item.confidence_score, 0]
            );
        }
        await emitSystemLog('AI Research service refresh completed', 'success', { page, target_date: targetDate, inserted_rows: normalized.length });
        return { page, count: normalized.length, data: normalized, use_lite: useLite };
    }

    const normalized = validItems.map(normalizeSuggestionItem);
    const deleted = await db.query(
        `DELETE FROM ai_suggestions WHERE ${localDateSql('created_at')} = $1`,
        [targetDate]
    );
    await emitSystemLog('AI Research service old rows cleared', 'info', { page, target_date: targetDate, deleted_rows: deleted.rowCount });
    for (const item of normalized) {
        await db.query(
            `INSERT INTO ai_suggestions
             (recommendation_title, recommendation_text, confidence_score, urgency_score, roi_score, reasoning_summary, next_action, topic, raw_data)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [item.recommendation_title, item.recommendation_text, item.confidence_score, item.urgency_score, item.roi_score, item.reasoning_summary, item.next_action, item.topic, JSON.stringify(item)]
        );
    }
    await emitSystemLog('AI Research service refresh completed', 'success', { page, target_date: targetDate, inserted_rows: normalized.length });
    return { page, count: normalized.length, data: normalized, use_lite: useLite };
}

// ─── Trend Research API ──────────────────────────────────────────────

async function getProductTrends(options = {}) {
    const market = options.market || 'vn';
    const categories = options.categories || DEFAULT_CATEGORIES;
    const window = normalizeTrendWindow(options.window || 'last_7_days');
    const limit = clampResearchLimit(options.limit);
    const forceFresh = !!(options.forceFresh || options.skipCache);
    
    const categoriesStr = Array.isArray(categories) ? categories.join(',') : categories;
    const marketHash = hash(market);
    const categoryHash = hash(categoriesStr);
    const windowHash = hash(window);
    
    const cacheKey = `trends:${market}:${categoriesStr}:${window}`;
    return withInFlight(cacheKey, async () => {
        let marketSnapshot = options.marketSnapshot || null;
        if (!marketSnapshot) {
            marketSnapshot = await fetchMarketSnapshot().catch(() => null);
        }
        let prompt = await getPromptText('overview', {
            MARKET: market,
            LANGUAGE: 'Vietnamese',
            CATEGORIES: categoriesStr,
            SOURCE_WINDOW: window,
            WINDOW_DESCRIPTION: TREND_WINDOWS[window],
            CURRENT_DATE: currentLocalDate(),
            LIMIT: limit,
            MODE: 'overview'
        });
        prompt += `

SOURCE WINDOW REQUIREMENT:
- source_window must be exactly "${window}".
- Current date is ${currentLocalDate()}.
- Analyze ${TREND_WINDOWS[window]}.
- For "today", prioritize products with same-day spikes, newly viral posts, marketplace rank jumps, or search/social acceleration today.
- For "last_3_days", prioritize products with acceleration in the last 72 hours.
- For "last_7_days", prioritize products with reliable weekly momentum.
- Return ${MIN_RESEARCH_RESULTS} to ${limit} results whenever verifiable. Prefer the maximum useful result count.
- Rank by importance, heat, popularity, practical value, and evidence strength.
- Daily repeats are allowed when the product is still hot or still has strong fresh evidence inside the selected source window.
- Do not reuse stale generic evergreen products unless they have a clear signal inside this source window.`;
        prompt += await buildMarketSnapshotPromptContext({
            page: 'product_trends',
            categories,
            marketSnapshot
        });
        prompt += `
SOURCE-FIRST CONTRACT:
- Use only REAL-TIME MARKET DATA candidates and Exact URL values above.
- Copy source_url/source_urls exactly from Exact URL lines.
- Do not browse, infer, synthesize, shorten, or guess URLs, product slugs, or item IDs.
- If a product has no Exact URL or news URL, skip it.`;
        
        const quota = await getQuota();
        const useLite = options.useLite ?? false;
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
            aiData = await callGeminiWithFallbacks(prompt, {
                endpoint: 'product_trends',
                useLite,
                listKeys: ['items', 'products', 'trends', 'data'],
                allowNoSearchRetry: false,
                googleSearch: false
            });
        } catch (err) {
            await emitSystemLog('Product Trends AI refresh failed', 'error', {
                window,
                market,
                error: err ? err.message : 'Unknown error'
            });
            const sourceFallback = validateProductTrendItems(
                productSeedFromSnapshot(marketSnapshot, window, limit).map((item, index) => normalizeProductTrendItem(item, index, window)),
                window
            ).slice(0, limit);
            if (sourceFallback.length >= MIN_RESEARCH_RESULTS) {
                aiData = { items: sourceFallback };
                await emitSystemLog('Product Trends using source-first snapshot fallback', 'warning', {
                    window,
                    market,
                    count: sourceFallback.length,
                    reason: err.message
                });
            } else if (forceFresh) {
                throw err;
            } else {
            const fallback = await getTrendsFromDB(market, categoriesStr, window);
            return { data: fallback, is_stale: true, schema_version: 'V4.0.1', from_fallback: true };
            }
        }

        
        const results = extractList(aiData, ['items', 'products', 'trends', 'data']);
        const normalizedResults = results.map((item, index) => normalizeProductTrendItem(item, index, window));
        const validResults = validateProductTrendItems(normalizedResults, window);
        let bounded = validResults.slice(0, limit);

        if (bounded.length < MIN_RESEARCH_RESULTS) {
            bounded = await expandProductTrendResults({
                basePrompt: prompt,
                endpoint: 'product_trends',
                useLite,
                window,
                limit,
                bounded
            });
        }

        bounded = await verifyResearchItems(bounded, {
            page: 'product_trends',
            marketSnapshot
        });
        
        if (bounded.length >= MIN_RESEARCH_RESULTS) {
            // Server-side timestamp and schema injection (Patch #4 & #7)
            bounded = bounded.map(item => ({
                ...item,
                canonical_id: item.id,
                id: windowProductId(item.id, window, currentLocalDate()),
                source_window: window
            }));
            bounded = injectServerTimestamp(bounded);
            await emitSystemLog('Product Trends validated results ready for storage', 'info', {
                window,
                market,
                count: bounded.length,
                target_date: currentLocalDate()
            });

            // Store to cache
            await db.query(
                `INSERT INTO cached_product_trends (market_hash, category_hash, source_window_hash, prompt_hash, model_hash, data, expires_at)
                 VALUES ($1, $2, $3, $4, $5, $6, NOW() + INTERVAL '24 hours')
                 ON CONFLICT (market_hash, category_hash, source_window_hash, prompt_hash, model_hash)
                 DO UPDATE SET data = EXCLUDED.data, expires_at = EXCLUDED.expires_at, created_at = NOW()`,
                [marketHash, categoryHash, windowHash, promptHash, modelHash, JSON.stringify(bounded)]
            );
            await emitSystemLog('Product Trends cache updated', 'info', { window, market, count: bounded.length });
            
            // Store to main tables
            const deleted = await db.query(
                `DELETE FROM product_trend_results
                 WHERE market = $1
                   AND source_window = $2
                   AND ${productDateSql('created_at')} = $3`,
                [market, window, currentLocalDate()]
            );
            await emitSystemLog('Product Trends old daily rows cleared', 'info', {
                window,
                market,
                target_date: currentLocalDate(),
                deleted_rows: deleted.rowCount
            });
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
            await emitSystemLog('Product Trends DB rows upserted', 'success', {
                window,
                market,
                target_date: currentLocalDate(),
                upserted_rows: bounded.length
            });
            return { data: bounded, is_stale: false, schema_version: 'V4.0.1' };
        } else {
            await emitSystemLog('Product Trends AI response had no valid fresh rows', 'warning', {
                window,
                market,
                raw_items: results.length,
                normalized_items: normalizedResults.length,
                valid_items: validResults.length
            });
            if (forceFresh) {
                throw new Error(`Gemini returned only ${bounded.length} valid fresh product trends for ${window}; refusing to write low-volume/low-confidence output.`);
            }
            const fallback = await getTrendsFromDB(market, categoriesStr, window);
            await emitSystemLog('Product Trends valid result empty, using DB fallback', 'warning', {
                window,
                market,
                fallback_rows: fallback.length
            });
            return { data: fallback, is_stale: true, schema_version: 'V4.0.1', from_fallback: true };
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
    let marketSnapshot = null;
    try {
        marketSnapshot = await fetchMarketSnapshot();
    } catch (err) {
        await emitSystemLog('Daily research market snapshot failed; prompts will fall back to source-only evidence', 'warning', {
            error: err.message
        });
    }
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
                limit: DEFAULT_RESEARCH_RESULTS,
                forceFresh: true,
                marketSnapshot
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
            const res = await refreshLegacyResearchPage(page, {
                source_window: 'last_7_days',
                marketSnapshot,
                refreshDependencies: false
            });
            console.log(`[Research] Refreshed ${res.count} ${page} legacy items.`);
            summary.legacy[page] = res.count;
        } catch (err) {
            console.error(`[Research] ${page} legacy error:`, err.message);
            summary.errors.push({ page, error: err.message });
        }
    }
    const insertedCount = [
        ...Object.values(summary.trends),
        ...Object.values(summary.legacy)
    ].reduce((total, count) => total + Number(count || 0), 0);
    if (summary.errors.length) console.error(`[Research] Daily job completed with ${summary.errors.length} errors.`);
    if (insertedCount <= 0) {
        const error = new Error('Daily AI Research finished without inserting any fresh rows.');
        error.summary = summary;
        throw error;
    }
    return summary;
}

async function getTrendsFromDB(market, categoriesStr, window = 'today') {
    const categories = categoriesStr.split(',').map(s => s.trim());
    const normalizedWindow = normalizeTrendWindow(window);
    const r = await db.query(
        `SELECT raw_data
         FROM product_trend_results
         WHERE market = $1 AND category = ANY($2) AND source_window = $3
         ORDER BY created_at DESC
         LIMIT ${DEFAULT_RESEARCH_RESULTS}`,
        [market, categories, normalizedWindow]
    );
    const filtered = r.rows
        .map(row => row.raw_data)
        .filter(item => item
            && confidenceScore(item.confidence_score, 0) >= 70
            && hasDateInsideWindow(item.source_dates || item.source_date, normalizedWindow)
            && hasQualityEvidence(item));
    return filtered.length >= MIN_RESEARCH_RESULTS ? filtered : [];
}

// ─── Export ────────────────────────────────────────────────────────────────

module.exports = {
    getProductTrends,
    getProductDetail,
    refreshLegacyResearchPage,
    runDailyTrendResearch,
    SEED_TOPICS: DEFAULT_CATEGORIES
};
