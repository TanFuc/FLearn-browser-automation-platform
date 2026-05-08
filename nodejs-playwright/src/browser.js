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
    const path = require('path');
    const userDataDir = path.join(config.PROFILES_DIR, accountId);
    
    // Tự động xóa file Lock của Chrome nếu tồn tại (Sửa lỗi "Existing browser session")
    const lockFile = path.join(userDataDir, 'SingletonLock');
    if (fs.existsSync(lockFile)) {
        try {
            fs.unlinkSync(lockFile);
            console.log(`[${accountId}] Đã xóa file SingletonLock để giải phóng Profile.`);
        } catch (e) {
            // Nếu không xóa được, có thể tiến hành giết process (nâng cao)
        }
    }

    const profile = await getAccountProfile(accountId);

    // Parse proxy string - Hỗ trợ các định dạng phổ biến
    let proxyConfig = undefined;
    if (proxyString && proxyString.trim() !== "") {
        try {
            let p = proxyString.trim();
            if (!p.startsWith('http')) p = 'http://' + p;
            
            const url = new URL(p);
            proxyConfig = { server: `${url.protocol}//${url.hostname}${url.port ? ':' + url.port : ''}` };
            if (url.username) proxyConfig.username = decodeURIComponent(url.username);
            if (url.password) proxyConfig.password = decodeURIComponent(url.password);
            
            console.log(`[${accountId}] Sử dụng Proxy: ${proxyConfig.server}`);
        } catch(e) {
            // Thử parse định dạng ip:port:user:pass
            const parts = proxyString.split(':');
            if (parts.length === 4) {
                proxyConfig = {
                    server: `http://${parts[0]}:${parts[1]}`,
                    username: parts[2],
                    password: parts[3]
                };
                console.log(`[${accountId}] Sử dụng Proxy (định dạng ip:port:user:pass): ${proxyConfig.server}`);
            } else {
                console.error(`[${accountId}] Lỗi định dạng proxy: ${proxyString}`);
            }
        }
    }

    console.log(`[${accountId}] Đang khởi tạo trình duyệt với Profile: ${userDataDir}`);

    const context = await chromium.launchPersistentContext(userDataDir, {
        headless,
        userAgent:         profile.userAgent,
        viewport:          null,
        screen:            { width: profile.screenWidth, height: profile.screenHeight },
        timezoneId:        profile.timezoneId,
        locale:            profile.locale,
        colorScheme:       'light',
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
            `--window-size=${profile.viewport.width},${profile.viewport.height}`,
        ],
        ignoreDefaultArgs: ['--enable-automation'],
    });

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // Thiết lập timeout mặc định
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    return { context, page };
}

module.exports = { createOrLoadContext, getAccountProfile };
