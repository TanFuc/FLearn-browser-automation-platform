const { chromium } = require('playwright');
const fs = require('fs');
const config = require('./config');
const db = require('./db');

// Ensure profile directories exist
if (!fs.existsSync(config.PROFILES_DIR)) fs.mkdirSync(config.PROFILES_DIR, { recursive: true });
if (!fs.existsSync(config.LOGS_DIR)) fs.mkdirSync(config.LOGS_DIR, { recursive: true });

/**
 * Stable deterministic hash — same accountId always picks same index.
 */
function stableHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        hash = (hash * 31 + str.charCodeAt(i)) >>> 0;
    }
    return hash;
}

/**
 * Load UA and Viewport pools from DB, assign one deterministically to the account
 * and persist the fingerprint in accounts.fingerprint (JSONB).
 * On subsequent calls the stored fingerprint is returned immediately — no reassignment.
 */
async function getAccountProfile(accountId) {
    // 1. Return cached fingerprint if already stored
    const existing = await db.query(
        'SELECT fingerprint FROM accounts WHERE id = $1', [accountId]
    );
    if (existing.rows.length > 0 && existing.rows[0].fingerprint) {
        return existing.rows[0].fingerprint;
    }

    // 2. Load pools from DB
    const uaRows = await db.query('SELECT user_agent, platform FROM ua_pool WHERE is_active = TRUE ORDER BY id');
    const vpRows = await db.query('SELECT width, height FROM viewport_pool WHERE is_active = TRUE ORDER BY id');

    if (uaRows.rows.length === 0) throw new Error('ua_pool is empty — add at least one user agent via the database.');
    if (vpRows.rows.length === 0) throw new Error('viewport_pool is empty — add at least one viewport via the database.');

    // 3. Pick deterministically per accountId (same account = same UA/viewport forever)
    const uaEntry = uaRows.rows[stableHash(accountId + '_ua') % uaRows.rows.length];
    const vp      = vpRows.rows[stableHash(accountId + '_vp') % vpRows.rows.length];

    const fingerprint = {
        userAgent:         uaEntry.user_agent,
        platform:          uaEntry.platform,
        viewport:          { width: vp.width, height: vp.height },
        screenWidth:       vp.width,
        screenHeight:      vp.height + 40,  // +40px taskbar
        colorDepth:        24,
        deviceScaleFactor: 1,
        timezoneId:        'Asia/Ho_Chi_Minh',
        locale:            'vi-VN',
    };

    // 4. Persist to DB
    await db.query(
        'UPDATE accounts SET fingerprint = $1 WHERE id = $2',
        [fingerprint, accountId]
    );

    return fingerprint;
}

async function createOrLoadContext(accountId, proxyString = null, headless = false) {
    const userDataDir = require('path').join(config.PROFILES_DIR, accountId);
    const profile = await getAccountProfile(accountId);

    // Parse proxy string
    let proxyConfig = undefined;
    if (proxyString) {
        try {
            const url = new URL(proxyString);
            proxyConfig = { server: `${url.protocol}//${url.hostname}:${url.port}` };
            if (url.username) proxyConfig.username = decodeURIComponent(url.username);
            if (url.password) proxyConfig.password = decodeURIComponent(url.password);
        } catch(e) {
            console.error(`[${accountId}] Lỗi parse proxy: ${proxyString}`);
        }
    }

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        userAgent:         profile.userAgent,
        viewport:          profile.viewport,
        screen:            { width: profile.screenWidth, height: profile.screenHeight },
        timezoneId:        profile.timezoneId,
        locale:            profile.locale,
        colorScheme:       'light',
        deviceScaleFactor: profile.deviceScaleFactor,
        proxy:             proxyConfig,
        args: [
            '--disable-blink-features=AutomationControlled',
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-infobars',
            '--disable-notifications',
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--disable-software-rasterizer',
            '--disable-features=IsolateOrigins,site-per-process',
            '--disable-site-isolation-trials',
            `--window-size=${profile.viewport.width},${profile.viewport.height}`,
            '--excludeSwitches=enable-automation',
            '--disable-extensions-except=',
            '--disable-component-extensions-with-background-pages',
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    });

    // Inject stealth overrides into every page context
    await context.addInitScript((p) => {
        Object.defineProperty(navigator, 'webdriver',           { get: () => undefined });
        Object.defineProperty(navigator, 'platform',            { get: () => p.platform });
        Object.defineProperty(navigator, 'languages',           { get: () => ['vi-VN', 'vi', 'en-US', 'en'] });
        Object.defineProperty(navigator, 'language',            { get: () => 'vi-VN' });
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => 8 });
        Object.defineProperty(navigator, 'deviceMemory',        { get: () => 8 });

        Object.defineProperty(navigator, 'plugins', {
            get: () => Object.assign([
                { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer',              description: 'Portable Document Format' },
                { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '' },
                { name: 'Native Client',      filename: 'internal-nacl-plugin',             description: '' },
            ], { length: 3 }),
        });

        Object.defineProperty(screen, 'width',       { get: () => p.screenWidth });
        Object.defineProperty(screen, 'height',      { get: () => p.screenHeight });
        Object.defineProperty(screen, 'availWidth',  { get: () => p.screenWidth });
        Object.defineProperty(screen, 'availHeight', { get: () => p.screenHeight - 40 });
        Object.defineProperty(screen, 'colorDepth',  { get: () => p.colorDepth });
        Object.defineProperty(screen, 'pixelDepth',  { get: () => p.colorDepth });

        const origQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (params) =>
            params.name === 'notifications'
                ? Promise.resolve({ state: Notification.permission })
                : origQuery(params);

        // Remove ChromeDriver artifact keys
        ['cdc_adoQpoasnfa76pfcZLmcfl_Array',
         'cdc_adoQpoasnfa76pfcZLmcfl_Promise',
         'cdc_adoQpoasnfa76pfcZLmcfl_Symbol'].forEach(k => delete window[k]);
    }, profile);

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    await page.setExtraHTTPHeaders({
        'Accept-Language':           'vi-VN,vi;q=0.9,en-US;q=0.8,en;q=0.7',
        'Accept':                    'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
        'Sec-Ch-Ua':                 '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
        'Sec-Ch-Ua-Mobile':          '?0',
        'Sec-Ch-Ua-Platform':        profile.platform === 'MacIntel' ? '"macOS"' : '"Windows"',
        'Upgrade-Insecure-Requests': '1',
    });

    return { context, page };
}

module.exports = { createOrLoadContext, getAccountProfile };
