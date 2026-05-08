const db = require('./src/db');

async function run() {
    console.log('🔄 Running Product Trend Intelligence V4.0.1 Migration...');
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('Creating product_trend_results...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS product_trend_results (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                product_id TEXT UNIQUE NOT NULL,
                market TEXT NOT NULL,
                category TEXT NOT NULL,
                raw_data JSONB,
                summary_data JSONB,
                schema_version TEXT DEFAULT 'V4.0.1',
                model_name TEXT,
                source_window TEXT,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        console.log('Creating product_trend_details...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS product_trend_details (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                product_id TEXT NOT NULL REFERENCES product_trend_results(product_id) ON DELETE CASCADE,
                type TEXT NOT NULL, -- 'deep_dive' or 'opportunity'
                detail_data JSONB,
                schema_version TEXT DEFAULT 'V4.0.1',
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(product_id, type)
            )
        `);

        console.log('Creating cached_product_trends...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS cached_product_trends (
                market_hash TEXT NOT NULL,
                category_hash TEXT NOT NULL,
                source_window_hash TEXT NOT NULL,
                prompt_hash TEXT NOT NULL,
                model_hash TEXT NOT NULL,
                data JSONB NOT NULL,
                expires_at TIMESTAMP NOT NULL,
                created_at TIMESTAMP DEFAULT NOW(),
                UNIQUE(market_hash, category_hash, source_window_hash, prompt_hash, model_hash)
            )
        `);
        
        await client.query('COMMIT');
        console.log('\n✅ V4 Migration complete!');
    } catch (e) {
        await client.query('ROLLBACK');
        console.error('❌ Migration failed:', e.message);
        process.exit(1);
    } finally {
        client.release();
        process.exit(0);
    }
}

run();
