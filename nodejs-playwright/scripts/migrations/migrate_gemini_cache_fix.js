const db = require('../../src/db');

async function run() {
    console.log('🔄 Recreating cached_research for Gemini Wrapper...');
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('Dropping old cached_research table...');
        await client.query(`DROP TABLE IF EXISTS cached_research`);
        
        console.log('Creating new cached_research table...');
        await client.query(`
            CREATE TABLE cached_research (
                id SERIAL PRIMARY KEY,
                cache_key TEXT UNIQUE NOT NULL,
                payload_json JSONB NOT NULL,
                expires_at TIMESTAMPTZ NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        
        await client.query('COMMIT');
        console.log('\n✅ Recreate complete!');
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
