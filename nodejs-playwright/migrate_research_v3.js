const db = require('./src/db');

async function run() {
    console.log('🔄 Running research module migration V3...');
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('Adding raw_data to ai_suggestions...');
        await client.query(`ALTER TABLE ai_suggestions ADD COLUMN IF NOT EXISTS raw_data JSONB`);
        
        await client.query('COMMIT');
        console.log('\n✅ Research migration V3 complete!');
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
