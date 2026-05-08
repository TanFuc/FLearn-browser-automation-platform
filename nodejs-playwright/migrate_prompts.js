const db = require('./src/db');

async function run() {
    console.log('Creating research_prompts table...');

    await db.query(`
        CREATE TABLE IF NOT EXISTS research_prompts (
            id SERIAL PRIMARY KEY,
            page_type VARCHAR(20) NOT NULL,
            variant_name VARCHAR(80) NOT NULL,
            prompt_text TEXT NOT NULL,
            is_active BOOLEAN DEFAULT FALSE,
            created_at TIMESTAMPTZ DEFAULT NOW(),
            updated_at TIMESTAMPTZ DEFAULT NOW()
        )
    `);

    await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS research_prompts_unique_variant
        ON research_prompts(page_type, variant_name)
    `);

    await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS research_prompts_active_unique
        ON research_prompts(page_type)
        WHERE is_active = TRUE
    `);

    console.log('✅ research_prompts ready');
    process.exit(0);
}

run().catch(err => { console.error('❌', err.message); process.exit(1); });
