const db = require('../../src/db');

async function run() {
    // 1. Create ua_pool table
    await db.query(`
        CREATE TABLE IF NOT EXISTS ua_pool (
            id SERIAL PRIMARY KEY,
            user_agent TEXT NOT NULL UNIQUE,
            platform VARCHAR(20) DEFAULT 'Win32',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✓ ua_pool table ready');

    // 2. Create viewport_pool table
    await db.query(`
        CREATE TABLE IF NOT EXISTS viewport_pool (
            id SERIAL PRIMARY KEY,
            width INTEGER NOT NULL,
            height INTEGER NOT NULL,
            is_active BOOLEAN DEFAULT TRUE,
            UNIQUE(width, height)
        )
    `);
    console.log('✓ viewport_pool table ready');

    // 3. Add fingerprint column to accounts if missing
    await db.query(`
        ALTER TABLE accounts 
        ADD COLUMN IF NOT EXISTS fingerprint JSONB DEFAULT NULL
    `);
    console.log('✓ accounts.fingerprint column ready');

    // 4. Seed default user agents
    const uas = [
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'Win32'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', 'Win32'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36', 'Win32'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36', 'MacIntel'],
        ['Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36', 'MacIntel'],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36 Edg/124.0.0.0', 'Win32'],
    ];
    for (const [ua, platform] of uas) {
        await db.query(
            `INSERT INTO ua_pool (user_agent, platform) VALUES ($1, $2) ON CONFLICT (user_agent) DO NOTHING`,
            [ua, platform]
        );
    }
    console.log('✓ ua_pool seeded with', uas.length, 'entries');

    // 5. Seed default viewports
    const viewports = [
        [1920, 1080], [1536, 864], [1440, 900],
        [1366, 768], [1280, 800], [2560, 1440],
    ];
    for (const [w, h] of viewports) {
        await db.query(
            `INSERT INTO viewport_pool (width, height) VALUES ($1, $2) ON CONFLICT (width, height) DO NOTHING`,
            [w, h]
        );
    }
    console.log('✓ viewport_pool seeded with', viewports.length, 'entries');

    console.log('\n✅ Migration complete!');
    process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
