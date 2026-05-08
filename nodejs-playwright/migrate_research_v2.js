const db = require('./src/db');

async function run() {
    console.log('🔄 Running research module migration V2...');
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('Dropping old cached_research table...');
        await client.query(`DROP TABLE IF EXISTS cached_research`);
        
        console.log('Creating new cached_research table with schema H...');
        await client.query(`
            CREATE TABLE cached_research (
                id SERIAL PRIMARY KEY,
                topic_hash VARCHAR(64) NOT NULL,
                prompt_hash VARCHAR(64) NOT NULL,
                page_type VARCHAR(30) NOT NULL,
                model_version VARCHAR(50) NOT NULL,
                meta JSONB NOT NULL,
                data JSONB NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '24 hours',
                UNIQUE(topic_hash, page_type, prompt_hash)
            )
        `);
        
        console.log('Creating index on expires_at...');
        await client.query(`CREATE INDEX IF NOT EXISTS idx_cached_research_expires ON cached_research(expires_at)`);
        
        await client.query('COMMIT');
        console.log('\n✅ Research migration V2 complete!');
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
