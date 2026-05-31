/**
 * Browser-backed marketplace scraper.
 *
 * Shopee/Lazada frequently block direct HTTP API calls. This module uses the
 * project's CloakBrowser persistent context so marketplace collection behaves
 * like a normal Vietnamese desktop browsing session and degrades to [] on any
 * checkpoint, 403, selector drift, or navigation failure.
 */
const { createOrLoadContext } = require('./browser');
const { randomDelay } = require('./utils');
const { emitSystemLog } = require('./logger');

const DEFAULT_KEYWORDS = ['my pham', 'do gia dung', 'do an vat', 'phu kien dien thoai', 'me va be'];
const MARKETPLACE_TIMEOUT = parseInt(process.env.MARKET_SCRAPER_TIMEOUT || '45000', 10);
const MARKETPLACE_HEADLESS = process.env.MARKET_SCRAPER_HEADLESS !== 'false';

function normalizePriceText(value) {
    const text = String(value || '').replace(/\s+/g, ' ').trim();
    return text || null;
}

function numberFromText(value) {
    const text = String(value || '').toLowerCase().replace(/,/g, '.');
    const match = text.match(/(\d+(?:\.\d+)?)/);
    if (!match) return null;
    const n = Number(match[1]);
    if (!Number.isFinite(n)) return null;
    if (/(k|nghìn|ngan)/i.test(text)) return Math.round(n * 1000);
    if (/(tr|triệu|m)/i.test(text)) return Math.round(n * 1000000);
    return Math.round(n);
}

async function installMarketplaceStealth(page) {
    try {
        await page.addInitScript(() => {
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
            Object.defineProperty(navigator, 'languages', { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
            Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
            window.chrome = window.chrome || { runtime: {} };
        });
        await page.setExtraHTTPHeaders({
            'Accept-Language': 'vi-VN,vi;q=0.9,en-US;q=0.7,en;q=0.6',
            'Upgrade-Insecure-Requests': '1'
        });
    } catch (err) {
        await emitSystemLog('Marketplace stealth setup skipped', 'warning', { error: err.message });
    }
}

async function humanScroll(page, rounds = 4) {
    for (let i = 0; i < rounds; i++) {
        try {
            const y = Math.floor(Math.random() * 500) + 450;
            await page.evaluate(scrollY => window.scrollBy({ top: scrollY, behavior: 'smooth' }), y);
            if (Math.random() > 0.55) {
                await page.mouse.move(Math.floor(Math.random() * 700) + 80, Math.floor(Math.random() * 500) + 120, { steps: 8 });
            }
            await randomDelay(900, 2200);
        } catch (err) {
            await emitSystemLog('Marketplace human scroll failed', 'warning', { error: err.message });
            break;
        }
    }
}

async function isBlocked(page) {
    try {
        const url = page.url();
        const title = await page.title().catch(() => '');
        const text = await page.evaluate(() => document.body?.innerText?.slice(0, 3000) || '').catch(() => '');
        return /captcha|checkpoint|verify|robot|unusual traffic|403|access denied|blocked/i.test(`${url}\n${title}\n${text}`);
    } catch (err) {
        return false;
    }
}

async function withMarketplacePage(accountId, scraperName, fn) {
    let context;
    let page;
    try {
        await emitSystemLog(`${scraperName} browser scrape started`, 'info', { account_id: accountId, headless: MARKETPLACE_HEADLESS });
        const result = await createOrLoadContext(accountId, null, MARKETPLACE_HEADLESS);
        context = result.context;
        page = result.page;
        await installMarketplaceStealth(page);
        page.setDefaultTimeout(MARKETPLACE_TIMEOUT);
        page.setDefaultNavigationTimeout(MARKETPLACE_TIMEOUT);
        return await fn(page);
    } catch (err) {
        await emitSystemLog(`${scraperName} browser scrape failed`, 'warning', { error: err.message });
        return [];
    } finally {
        if (page) await page.close().catch(() => {});
        if (context) await context.close().catch(() => {});
    }
}

async function collectShopeeFromDom(page, limit) {
    return page.evaluate(max => {
        const visibleText = node => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
        const cards = Array.from(document.querySelectorAll([
            '[data-sqe="item"]',
            'a[href*="-i."]',
            '.flash-sale-item-card',
            '.shopee-search-item-result__item'
        ].join(',')));
        const seen = new Set();
        const results = [];
        for (const card of cards) {
            if (results.length >= max) break;
            const text = visibleText(card);
            const nameNode = card.querySelector('[data-sqe="name"], .line-clamp-2, .flash-sale-item-card__item-name, [class*="name"]');
            const name = visibleText(nameNode) || text.split('\n').find(line => line.length > 12 && !/₫|đã bán|sold/i.test(line));
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            const priceNode = card.querySelector('[class*="price"], .flash-sale-item-card__current-price');
            const soldMatch = text.match(/(?:đã bán|sold)\s*([\d.,]+\s*(?:k|nghìn|tr|m)?)/i);
            const discountMatch = text.match(/-\s*\d+%|\d+%\s*giảm/i);
            const linkNode = card.closest('a[href]') || card.querySelector('a[href]');
            results.push({
                name,
                price: visibleText(priceNode) || null,
                sold_text: soldMatch ? soldMatch[0] : null,
                discount: discountMatch ? discountMatch[0] : null,
                url: linkNode ? new URL(linkNode.getAttribute('href'), location.origin).href : location.href,
                source: 'shopee_browser'
            });
        }
        return results;
    }, limit);
}

async function scrapeShopeeTrending(limit = 15, options = {}) {
    const keywords = options.keywords || DEFAULT_KEYWORDS;
    const keyword = options.keyword || keywords[Math.floor(Math.random() * keywords.length)];
    return withMarketplacePage('market_scraper_shopee', 'Shopee', async page => {
        const url = `https://shopee.vn/search?keyword=${encodeURIComponent(keyword)}&sortBy=sales`;
        try {
            await page.goto('https://shopee.vn/', { waitUntil: 'domcontentloaded', timeout: MARKETPLACE_TIMEOUT });
            await randomDelay(1400, 3200);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: MARKETPLACE_TIMEOUT });
            await randomDelay(2200, 4200);
            await humanScroll(page, options.scrollRounds || 5);
            if (await isBlocked(page)) {
                await emitSystemLog('Shopee scrape blocked by checkpoint/403', 'warning', { keyword });
                return [];
            }
            const items = await collectShopeeFromDom(page, limit);
            const normalized = items.map(item => ({
                ...item,
                keyword,
                sold: numberFromText(item.sold_text),
                price_vnd: normalizePriceText(item.price)
            })).filter(item => item.name);
            await emitSystemLog('Shopee browser scrape completed', 'info', { keyword, count: normalized.length });
            return normalized;
        } catch (err) {
            await emitSystemLog('Shopee scrape navigation failed', 'warning', { keyword, error: err.message });
            return [];
        }
    });
}

async function collectLazadaFromDom(page, limit) {
    return page.evaluate(max => {
        const visibleText = node => String(node?.innerText || node?.textContent || '').replace(/\s+/g, ' ').trim();
        const cards = Array.from(document.querySelectorAll('[data-qa-locator="product-item"], .Bm3ON, [class*="ProductItem"], a[href*="/products/"]'));
        const seen = new Set();
        const results = [];
        for (const card of cards) {
            if (results.length >= max) break;
            const text = visibleText(card);
            const nameNode = card.querySelector('[title], .RfADt, [class*="title"], [class*="name"]');
            const name = visibleText(nameNode) || nameNode?.getAttribute?.('title') || text.split('\n').find(line => line.length > 12 && !/₫|đã bán|sold/i.test(line));
            if (!name || seen.has(name.toLowerCase())) continue;
            seen.add(name.toLowerCase());
            const priceNode = card.querySelector('.ooOxS, [class*="price"]');
            const soldMatch = text.match(/(?:đã bán|sold)\s*([\d.,]+\s*(?:k|nghìn|tr|m)?)/i);
            const linkNode = card.closest('a[href]') || card.querySelector('a[href]');
            results.push({
                name,
                price: visibleText(priceNode) || null,
                sold_text: soldMatch ? soldMatch[0] : null,
                url: linkNode ? new URL(linkNode.getAttribute('href'), location.origin).href : location.href,
                source: 'lazada_browser'
            });
        }
        return results;
    }, limit);
}

async function scrapeLazadaTrending(limit = 15, options = {}) {
    const keywords = options.keywords || DEFAULT_KEYWORDS;
    const keyword = options.keyword || keywords[Math.floor(Math.random() * keywords.length)];
    return withMarketplacePage('market_scraper_lazada', 'Lazada', async page => {
        const url = `https://www.lazada.vn/catalog/?q=${encodeURIComponent(keyword)}&sort=popularity`;
        try {
            await page.goto('https://www.lazada.vn/', { waitUntil: 'domcontentloaded', timeout: MARKETPLACE_TIMEOUT });
            await randomDelay(1400, 3200);
            await page.goto(url, { waitUntil: 'domcontentloaded', timeout: MARKETPLACE_TIMEOUT });
            await randomDelay(2200, 4200);
            await humanScroll(page, options.scrollRounds || 5);
            if (await isBlocked(page)) {
                await emitSystemLog('Lazada scrape blocked by checkpoint/403', 'warning', { keyword });
                return [];
            }
            const items = await collectLazadaFromDom(page, limit);
            const normalized = items.map(item => ({
                ...item,
                keyword,
                sold: numberFromText(item.sold_text),
                price_vnd: normalizePriceText(item.price)
            })).filter(item => item.name);
            await emitSystemLog('Lazada browser scrape completed', 'info', { keyword, count: normalized.length });
            return normalized;
        } catch (err) {
            await emitSystemLog('Lazada scrape navigation failed', 'warning', { keyword, error: err.message });
            return [];
        }
    });
}

if (require.main === module) {
    Promise.all([
        scrapeShopeeTrending(5),
        scrapeLazadaTrending(5)
    ]).then(([shopee, lazada]) => {
        console.log(JSON.stringify({ shopee, lazada }, null, 2));
        process.exit(0);
    }).catch(err => {
        console.error(err);
        process.exit(1);
    });
}

module.exports = {
    scrapeShopeeTrending,
    scrapeLazadaTrending
};
