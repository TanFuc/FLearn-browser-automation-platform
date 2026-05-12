const db = require('./src/db');

async function run() {
    console.log('Running AFF VID migration...');
    try {
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
        console.log('AFF VID migration complete.');
    } catch (err) {
        console.error('AFF VID migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
}

run();
