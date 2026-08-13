const db = require('../../src/db');
async function run() {
    // Add name column
    await db.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS name VARCHAR(255)`);
    console.log('✓ Added accounts.name');

    // Add soft delete column
    await db.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ DEFAULT NULL`);
    console.log('✓ Added accounts.deleted_at');

    // hard_deleted_at is a marker set just before actual row deletion (used as audit log)
    // We also keep a separate audit log in a separate table for truly deleted accounts
    await db.query(`ALTER TABLE accounts ADD COLUMN IF NOT EXISTS hard_deleted_at TIMESTAMPTZ DEFAULT NULL`);
    console.log('✓ Added accounts.hard_deleted_at');

    // Create a deleted_accounts audit table to preserve hard-deleted records
    await db.query(`
        CREATE TABLE IF NOT EXISTS deleted_accounts (
            id VARCHAR(50),
            name VARCHAR(255),
            proxy VARCHAR(255),
            fb_email VARCHAR(255),
            group_url TEXT,
            daily_limit INTEGER,
            invites_sent_today INTEGER,
            unfollows_today INTEGER,
            deleted_at TIMESTAMPTZ,
            hard_deleted_at TIMESTAMPTZ DEFAULT NOW(),
            created_at TIMESTAMPTZ
        )
    `);
    console.log('✓ Created deleted_accounts audit table');

    console.log('\n✅ Migration complete!');
    process.exit(0);
}
run().catch(e => { console.error('❌', e.message); process.exit(1); });
