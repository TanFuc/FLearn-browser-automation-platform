let launchPersistentContext;
let humanizeBrowser;
try {
    // Th? load d?ng CommonJS tr??c
    const cloak = require('cloakbrowser');
    launchPersistentContext = cloak.launchPersistentContext;
    humanizeBrowser = cloak.humanizeBrowser;
} catch (e) {
    // N?u l?i ESM, d?ng dynamic import (h? tr? trong node async function)
    console.log('[Browser] CloakBrowser require failed, will use dynamic import in createOrLoadContext');
}
const fs = require('fs');
const { execFileSync } = require('child_process');
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

function resolveBrowserWindow(profile) {
    const settings = config.getSettings();
    const useCustom = settings.browserWindowMode === 'custom';
    const width = parseInt(settings.browserWindowWidth, 10);
    const height = parseInt(settings.browserWindowHeight, 10);

    if (useCustom && Number.isInteger(width) && Number.isInteger(height) && width >= 800 && height >= 500) {
        return { width, height, source: 'settings' };
    }

    return {
        width: profile.viewport.width,
        height: profile.viewport.height,
        source: 'fingerprint'
    };
}

function removeProfileLockFiles(accountId, userDataDir) {
    ['SingletonLock', 'SingletonCookie', 'SingletonSocket'].forEach(fileName => {
        const lockFile = require('path').join(userDataDir, fileName);
        if (!fs.existsSync(lockFile)) return;
        try {
            fs.unlinkSync(lockFile);
            console.log(`[${accountId}] Removed stale Chrome profile lock: ${fileName}`);
        } catch (err) {
            console.log(`[${accountId}] Could not remove ${fileName}: ${err.message}`);
        }
    });
}

function closeExistingProfileProcesses(accountId, userDataDir) {
    if (process.platform !== 'win32') return;
    const settings = config.getSettings();
    if (settings.closeExistingBrowserSession === false) return;

    const escaped = userDataDir.replace(/'/g, "''");
    const command = `
$profile = '${escaped}';
$escapedProfile = [WildcardPattern]::Escape($profile);
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -and $_.CommandLine -like "*--user-data-dir=$escapedProfile*" } |
  ForEach-Object {
    try {
      Stop-Process -Id $_.ProcessId -Force -ErrorAction Stop;
      Write-Output $_.ProcessId;
    } catch {}
  }
`;

    try {
        const killed = execFileSync('powershell.exe', ['-NoProfile', '-Command', command], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore']
        }).trim();
        if (killed) {
            console.log(`[${accountId}] Closed existing Chrome session for profile before launch: ${killed.replace(/\s+/g, ', ')}`);
        }
    } catch (err) {
        console.log(`[${accountId}] Existing Chrome session cleanup skipped: ${err.message}`);
    }
}

function makeBrowserLaunchError(accountId, err) {
    const message = String(err?.message || err);
    if (
        message.includes('Target page, context or browser has been closed') ||
        message.includes('current browser session') ||
        message.includes('Mở trong phiên')
    ) {
        const friendly = new Error(`Không mở được Chrome cho account ${accountId} vì profile này đang được một phiên Chrome khác giữ. Hãy đóng cửa sổ Chrome automation của account này rồi chạy lại.`);
        friendly.cause = err;
        return friendly;
    }
    return err;
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
    if (!launchPersistentContext) {
        try {
            const m = await import('cloakbrowser');
            launchPersistentContext = m.launchPersistentContext || m.default?.launchPersistentContext || m.default;
            humanizeBrowser = m.humanizeBrowser || m.default?.humanizeBrowser;
        } catch (err) {
            console.error('[Browser] Failed to dynamically import cloakbrowser:', err.message);
            throw err;
        }
    }
    const path = require('path');
    const userDataDir = path.join(config.PROFILES_DIR, accountId);
    
    // Tự động xóa file Lock của Chrome nếu tồn tại (Sửa lỗi "Existing browser session")
    removeProfileLockFiles(accountId, userDataDir);
    closeExistingProfileProcesses(accountId, userDataDir);

    const profile = await getAccountProfile(accountId);
    const browserWindow = resolveBrowserWindow(profile);

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
    console.log(`[${accountId}] Browser window: ${browserWindow.width}x${browserWindow.height} (${browserWindow.source})`);

    let context;
    try {
        context = await launchPersistentContext({
            userDataDir,
            headless,
            userAgent:         profile.userAgent,
            viewport:          { width: browserWindow.width, height: browserWindow.height },
            screen:            { width: browserWindow.width, height: browserWindow.height + 40 },
            timezone:          profile.timezoneId,
            locale:            profile.locale,
            colorScheme:       'light',
            proxy:             proxyConfig,
            stealthArgs:       true,
            geoip:             !!proxyConfig,
            args: [
                '--disable-blink-features=AutomationControlled',
                '--no-first-run',
                '--no-default-browser-check',
                '--disable-infobars',
                '--disable-notifications',
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                `--window-size=${browserWindow.width},${browserWindow.height}`,
            ],
        });
    } catch (err) {
        throw makeBrowserLaunchError(accountId, err);
    }

    if (typeof humanizeBrowser === 'function') {
        await humanizeBrowser(context.browser(), {
            timezone: profile.timezoneId,
            locale: profile.locale
        }).catch(err => console.log(`[${accountId}] CloakBrowser humanize skipped: ${err.message}`));
    }

    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    // Thiết lập timeout mặc định
    page.setDefaultTimeout(60000);
    page.setDefaultNavigationTimeout(60000);

    return { context, page };
}

module.exports = { createOrLoadContext, getAccountProfile };
