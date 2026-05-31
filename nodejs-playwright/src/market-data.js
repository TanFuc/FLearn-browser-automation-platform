/**
 * market-data.js — Real-time market data fetcher
 * Scrapes Google Trends, Shopee, và TikTok trending để inject vào Gemini prompt
 * Thay thế việc AI "đoán" thị trường bằng data thật
 */

const https = require('https');
const http = require('http');
const { scrapeShopeeTrending, scrapeLazadaTrending } = require('./shopee-scraper');

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function fetchJson(url, options = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const opts = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
                'Accept': 'application/json, text/plain, */*',
                'Accept-Language': 'vi-VN,vi;q=0.9',
                ...options.headers,
            },
            timeout: options.timeout || 10000,
        };
        const req = mod.get(url, opts, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
                catch { resolve({ status: res.statusCode, body: data }); }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

function fetchHtml(url, options = {}) {
    return new Promise((resolve, reject) => {
        const mod = url.startsWith('https') ? https : http;
        const opts = {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0 Safari/537.36',
                'Accept': 'text/html,application/xhtml+xml',
                'Accept-Language': 'vi-VN,vi;q=0.9',
                ...options.headers,
            },
            timeout: options.timeout || 12000,
        };
        const req = mod.get(url, opts, (res) => {
            // Follow redirect
            if ([301, 302, 303, 307].includes(res.statusCode) && res.headers.location) {
                return fetchHtml(res.headers.location, options).then(resolve).catch(reject);
            }
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ status: res.statusCode, body: data }));
        });
        req.on('error', reject);
        req.on('timeout', () => { req.destroy(); reject(new Error('Request timeout')); });
    });
}

// ─── Google Trends (RSS feed — không cần API key) ────────────────────────────

/**
 * Lấy trending searches từ Google Trends RSS
 * @param {string} geo - country code: VN, US, ...
 * @returns {Promise<string[]>} - list of trending topics
 */
async function getGoogleTrending(geo = 'VN') {
    try {
        const url = `https://trends.google.com/trending/rss?geo=${geo}`;
        const res = await fetchHtml(url);
        if (res.status !== 200) throw new Error(`HTTP ${res.status}`);

        // Parse plain <title> tags (RSS không dùng CDATA)
        const titles = [];
        for (const m of res.body.matchAll(/<title>(.*?)<\/title>/g)) {
            const t = m[1].trim();
            if (t && !t.toLowerCase().includes('daily search') && !t.toLowerCase().includes('google trends')) {
                titles.push(t);
            }
        }
        const traffic = [...res.body.matchAll(/<ht:approx_traffic>(.*?)<\/ht:approx_traffic>/g)].map(m => m[1].trim());
        const newsItems = [...res.body.matchAll(/<ht:news_item_title>(.*?)<\/ht:news_item_title>/g)].map(m => m[1].trim());

        return titles.slice(0, 20).map((title, i) => ({
            keyword: title,
            traffic: traffic[i] || null,
            related_news: newsItems.filter((_, ni) => ni === i) || [],
            source: 'google_trends',
            geo,
        }));
    } catch (e) {
        console.error('[MarketData] Google Trends error:', e.message);
        return [];
    }
}

// ─── Shopee Trending (public API không cần auth) ──────────────────────────────

/**
 * Lấy top sản phẩm Shopee flash sale / bestseller
 * @param {number} limit
 */
async function getShopeeTrending(limit = 20) {
    try {
        const keywords = ['m\u1ef9 ph\u1ea9m', 'thi\u1ebft b\u1ecb nh\u00e0 b\u1ebfp', '\u0111\u1ed3 \u0103n'];
        const kw = keywords[Math.floor(Math.random() * keywords.length)];
        const url = `https://shopee.vn/api/v4/search/search_items?keyword=${encodeURIComponent(kw)}&by=sales&limit=${Math.min(limit,50)}&newest=0&order=desc&page_type=search&scenario=PAGE_GLOBAL_SEARCH&version=2`;
        const res = await fetchJson(url, {
            headers: {
                'Referer': 'https://shopee.vn/',
                'x-api-source': 'pc',
                'x-shopee-language': 'vi',
                'x-requested-with': 'XMLHttpRequest',
                'Cookie': 'SPC_EC=-; SPC_F=guest; REC_T_ID=guest;',
            },
            timeout: 12000,
        });
        const items = res.body?.items || [];
        if (!items.length) {
            console.warn('[MarketData] Shopee returned 0 items, status:', res.status);
            return [];
        }
        return items.slice(0, limit).map(item => {
            const data = item.item_basic || item;
            const price = data.price ? Math.round(data.price / 100000) / 10 : null;
            return {
                name: data.name || '',
                price_vnd: price ? `${price}k` : null,
                sold: data.historical_sold || data.sold || 0,
                rating: data.item_rating?.rating_star ? Math.round(data.item_rating.rating_star * 10) / 10 : null,
                shop_location: data.shop_location || null,
                source: 'shopee_trending',
            };
        }).filter(p => p.name);
    } catch (e) {
        console.error('[MarketData] Shopee trending error:', e.message);
        return [];
    }
}

/**
 * Lấy flash sale Shopee (thường có trend spike)
 */
async function getShopeeFlashSale(limit = 15) {
    try {
        const url = 'https://shopee.vn/api/v4/flash_sale/get_all_sessions';
        const res = await fetchJson(url, {
            headers: { 'Referer': 'https://shopee.vn/' },
            timeout: 10000,
        });

        const sessions = res.body?.data?.sessions || [];
        if (!sessions.length) return [];

        // Lấy session đang active hoặc upcoming
        const now = Math.floor(Date.now() / 1000);
        const active = sessions.find(s => s.start_time <= now && s.end_time >= now)
            || sessions.find(s => s.start_time > now)
            || sessions[0];

        if (!active?.promotionid) return [];

        const itemsUrl = `https://shopee.vn/api/v4/flash_sale/flash_sale_batch_get_items?promotionid=${active.promotionid}&itemids=&limit=${limit}&offset=0&platform=PC`;
        const itemsRes = await fetchJson(itemsUrl, {
            headers: { 'Referer': 'https://shopee.vn/' },
            timeout: 10000,
        });

        const items = itemsRes.body?.data?.items || [];
        return items.slice(0, limit).map(item => ({
            name: item.name || '',
            original_price: item.price ? Math.round(item.price / 100000) / 10 + 'k' : null,
            sale_price: item.price_before_discount ? Math.round(item.price_before_discount / 100000) / 10 + 'k' : null,
            discount_pct: item.raw_discount || null,
            sold: item.sold || 0,
            stock: item.stock || null,
            source: 'shopee_flash_sale',
        })).filter(p => p.name);
    } catch (e) {
        console.error('[MarketData] Shopee flash sale error:', e.message);
        return [];
    }
}

// ─── Lazada Trending ──────────────────────────────────────────────────────────

async function getLazadaTrending(limit = 15) {
    try {
        const url = 'https://www.lazada.vn/catalog/?ajax=true&isFirstRequest=true&page=1&q=__best_seller__&sort=popularity&rating=0';
        const res = await fetchJson(url, {
            headers: { 'Referer': 'https://www.lazada.vn/' },
            timeout: 12000,
        });
        const items = res.body?.mods?.listItems || [];
        return items.slice(0, limit).map(item => ({
            name: item.name || '',
            price: item.priceShow || null,
            review_count: item.review || 0,
            rating: item.ratingScore || null,
            sold_count: item.itemSoldCntShow || null,
            source: 'lazada_trending',
        })).filter(p => p.name);
    } catch (e) {
        console.error('[MarketData] Lazada trending error:', e.message);
        return [];
    }
}

// ─── TikTok Trending Hashtags (scrape public page) ───────────────────────────

async function getTikTokTrending() {
    try {
        // TikTok Creative Center trending products (Vietnam)
        const url = 'https://ads.tiktok.com/business/creativecenter/product/hot/pc/vi/?period=7&region=VN';
        const res = await fetchHtml(url, { timeout: 12000 });

        // Extract product names from the page
        const nameMatches = res.body.matchAll(/"product_title":"([^"]+)"/g);
        const products = [];
        for (const m of nameMatches) {
            products.push({ name: m[1], source: 'tiktok_trending_products' });
        }

        return products.slice(0, 15);
    } catch (e) {
        console.error('[MarketData] TikTok trending error:', e.message);
        return [];
    }
}

// ─── Main: fetch all sources ─────────────────────────────────────────────────

/**
 * Fetch tất cả market data song song
 * @returns {Promise<object>} combined market snapshot
 */
async function fetchMarketSnapshot() {
    const startTime = Date.now();
    console.log('[MarketData] Fetching market snapshot...');

    const [googleTrends, shopeeTop, shopeeFlash, lazadaTop, lazadaApiTop, tiktokTrending] = await Promise.allSettled([
        getGoogleTrending('VN'),
        scrapeShopeeTrending(15).catch(() => []), // D?ng browser scraper
        getShopeeFlashSale(15),
        scrapeLazadaTrending(15).catch(() => []),
        getLazadaTrending(15),
        getTikTokTrending(),
    ]);

    const browserLazada = lazadaTop.status === 'fulfilled' ? lazadaTop.value : [];
    const apiLazada = lazadaApiTop.status === 'fulfilled' ? lazadaApiTop.value : [];

    const snapshot = {
        fetched_at: new Date().toISOString(),
        elapsed_ms: Date.now() - startTime,
        sources: {
            google_trends: googleTrends.status === 'fulfilled' ? googleTrends.value : [],
            shopee_top: shopeeTop.status === 'fulfilled' ? shopeeTop.value : [],
            shopee_flash_sale: shopeeFlash.status === 'fulfilled' ? shopeeFlash.value : [],
            lazada_top: browserLazada.length ? browserLazada : apiLazada,
            tiktok_products: tiktokTrending.status === 'fulfilled' ? tiktokTrending.value : [],
        },
        source_status: {
            google_trends: googleTrends.status,
            shopee_browser: shopeeTop.status,
            shopee_flash_sale: shopeeFlash.status,
            lazada_browser: lazadaTop.status,
            lazada_api: lazadaApiTop.status,
            tiktok_products: tiktokTrending.status
        }
    };

    const total = Object.values(snapshot.sources).reduce((s, arr) => s + arr.length, 0);
    console.log(`[MarketData] Snapshot ready: ${total} items from ${Object.keys(snapshot.sources).length} sources in ${snapshot.elapsed_ms}ms`);

    return snapshot;
}

/**
 * Format snapshot thành text context để inject vào Gemini prompt
 * @param {object} snapshot - từ fetchMarketSnapshot()
 * @param {object} options
 * @returns {string}
 */
function formatSnapshotForPrompt(snapshot, options = {}) {
    const { maxItemsPerSource = 10, categories = [] } = options;
    if (!snapshot || !snapshot.sources) {
        return [
            '=== REAL-TIME MARKET DATA ===',
            'No live marketplace snapshot was available. Use only verifiable source evidence.',
            '=== END MARKET DATA ===',
            ''
        ].join('\n');
    }
    const lines = [
        `=== REAL-TIME MARKET DATA (${snapshot.fetched_at}) ===`,
        `Sources: Google Trends VN, Shopee VN browser/API, Lazada VN browser/API, TikTok Trending`,
        '',
    ];

    const {
        google_trends = [],
        shopee_top = [],
        shopee_flash_sale = [],
        lazada_top = [],
        tiktok_products = []
    } = snapshot.sources;

    if (google_trends.length) {
        lines.push('## Google Trends VN (đang trending ngay bây giờ):');
        google_trends.slice(0, maxItemsPerSource).forEach((t, i) => {
            lines.push(`  ${i + 1}. ${t.keyword}${t.traffic ? ` (${t.traffic} searches)` : ''}`);
        });
        lines.push('');
    }

    if (shopee_top.length) {
        lines.push('## Shopee Top Sellers (theo doanh số):');
        shopee_top.slice(0, maxItemsPerSource).forEach((p, i) => {
            lines.push(`  ${i + 1}. ${p.name}${p.price_vnd || p.price ? ` — ${p.price_vnd || p.price}` : ''}${p.sold || p.sold_text ? ` — Đã bán: ${p.sold || p.sold_text}` : ''}`);
        });
        lines.push('');
    }

    if (shopee_flash_sale.length) {
        lines.push('## Shopee Flash Sale (đang hot):');
        shopee_flash_sale.slice(0, maxItemsPerSource).forEach((p, i) => {
            lines.push(`  ${i + 1}. ${p.name}${p.discount_pct ? ` (-${p.discount_pct}%)` : ''}${p.sold ? ` — Đã bán: ${p.sold}` : ''}`);
        });
        lines.push('');
    }

    if (lazada_top.length) {
        lines.push('## Lazada Trending:');
        lazada_top.slice(0, maxItemsPerSource).forEach((p, i) => {
            lines.push(`  ${i + 1}. ${p.name}${p.price_vnd || p.price ? ` — ${p.price_vnd || p.price}` : ''}${p.sold || p.sold_count ? ` — ${p.sold || p.sold_count}` : ''}`);
        });
        lines.push('');
    }

    if (tiktok_products.length) {
        lines.push('## TikTok Trending Products VN:');
        tiktok_products.slice(0, maxItemsPerSource).forEach((p, i) => {
            lines.push(`  ${i + 1}. ${p.name}`);
        });
        lines.push('');
    }

    lines.push('=== END MARKET DATA ===');
    lines.push('Use the above REAL DATA as grounding. Prioritize items that appear in multiple sources.');
    lines.push('');

    return lines.join('\n');
}

module.exports = {
    fetchMarketSnapshot,
    formatSnapshotForPrompt,
    getGoogleTrending,
    getShopeeTrending,
    getShopeeFlashSale,
    getLazadaTrending,
    getTikTokTrending,
};
