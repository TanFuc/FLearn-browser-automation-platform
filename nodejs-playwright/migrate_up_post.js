const db = require('./src/db');

async function run() {
    console.log('Running UP POST migration...');
    try {
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
        console.log('UP POST migration complete.');
    } catch (err) {
        console.error('UP POST migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
}

run();
