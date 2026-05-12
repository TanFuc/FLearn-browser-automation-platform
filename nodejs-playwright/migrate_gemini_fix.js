const db = require('./src/db');

async function run() {
    console.log('🔄 Running Gemini Schema Fix Migration...');
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('Updating quota_state table...');
        await client.query(`ALTER TABLE quota_state ADD COLUMN IF NOT EXISTS soft_token_cap INTEGER DEFAULT 100000`);
        await client.query(`ALTER TABLE quota_state ADD COLUMN IF NOT EXISTS hard_token_cap INTEGER DEFAULT 200000`);
        
        // Check if cached_research needs columns renamed or if we should just use existing ones
        // The current cached_research has: id, topic_hash, prompt_hash, page_type, model_version, meta, data, created_at, expires_at
        // gemini.js wants: cache_key (TEXT), payload_json (JSONB), updated_at (TIMESTAMP)
        
        // Instead of renaming, I'll update gemini.js to use prompt_hash and data.
        // But gemini.js also wants updated_at.
        await client.query(`ALTER TABLE cached_research ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
        
        await client.query('COMMIT');
        console.log('\n✅ Gemini Schema Fix complete!');
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
