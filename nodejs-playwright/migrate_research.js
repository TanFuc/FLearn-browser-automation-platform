const db = require('./src/db');

async function run() {
    console.log('🔄 Running research module migration...');

    await db.query(`
        CREATE TABLE IF NOT EXISTS research_topics (
            id SERIAL PRIMARY KEY,
            name VARCHAR(100) NOT NULL,
            category VARCHAR(50) DEFAULT 'general',
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✓ research_topics');

    await db.query(`
        CREATE TABLE IF NOT EXISTS cached_research (
            id SERIAL PRIMARY KEY,
            topic VARCHAR(100) NOT NULL,
            page_type VARCHAR(30) NOT NULL,
            data JSONB NOT NULL,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
            UNIQUE(topic, page_type)
        )
    `);
    console.log('✓ cached_research');

    await db.query(`
        CREATE TABLE IF NOT EXISTS research_results (
            id SERIAL PRIMARY KEY,
            topic VARCHAR(100),
            page_type VARCHAR(20),
            title VARCHAR(255),
            category VARCHAR(100),
            data JSONB,
            trend_score INTEGER DEFAULT 0,
            monetization_score INTEGER DEFAULT 0,
            competition_score INTEGER DEFAULT 0,
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✓ research_results');

    await db.query(`
        CREATE TABLE IF NOT EXISTS ai_suggestions (
            id SERIAL PRIMARY KEY,
            recommendation_title VARCHAR(255),
            recommendation_text TEXT,
            confidence_score INTEGER DEFAULT 0,
            urgency_score INTEGER DEFAULT 0,
            roi_score INTEGER DEFAULT 0,
            reasoning_summary TEXT,
            next_action TEXT,
            topic VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✓ ai_suggestions');

    await db.query(`
        CREATE TABLE IF NOT EXISTS api_usage_logs (
            id SERIAL PRIMARY KEY,
            model VARCHAR(50),
            prompt_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            cache_hit BOOLEAN DEFAULT FALSE,
            endpoint VARCHAR(100),
            created_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    console.log('✓ api_usage_logs');

    await db.query(`
        CREATE TABLE IF NOT EXISTS quota_state (
            id INTEGER PRIMARY KEY DEFAULT 1,
            date DATE DEFAULT CURRENT_DATE,
            request_count INTEGER DEFAULT 0,
            prompt_tokens INTEGER DEFAULT 0,
            output_tokens INTEGER DEFAULT 0,
            total_tokens INTEGER DEFAULT 0,
            cache_hits INTEGER DEFAULT 0,
            soft_cap INTEGER DEFAULT 20,
            hard_cap INTEGER DEFAULT 30,
            is_blocked BOOLEAN DEFAULT FALSE,
            last_cron_run TIMESTAMPTZ,
            last_successful_run TIMESTAMPTZ,
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await db.query(`INSERT INTO quota_state (id) VALUES (1) ON CONFLICT (id) DO NOTHING`);
    console.log('✓ quota_state');

    // Seed default topics
    const topics = [
        ['Skincare', 'affiliate'],
        ['Home Appliances', 'affiliate'],
        ['Fitness', 'affiliate'],
        ['Fashion', 'affiliate'],
        ['Mother and Baby', 'affiliate'],
    ];
    for (const [name, category] of topics) {
        await db.query(
            `INSERT INTO research_topics (name, category) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
            [name, category]
        );
    }
    console.log('✓ Seeded 5 default topics');

    console.log('\n✅ Research migration complete!');
    process.exit(0);
}

run().catch(e => { console.error('❌', e.message); process.exit(1); });
