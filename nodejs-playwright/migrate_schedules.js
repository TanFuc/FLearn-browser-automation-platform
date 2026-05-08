const db = require('./src/db');

async function run() {
    console.log('🔄 Running Automation Schedule Migration...');
    const client = await db.connect();
    
    try {
        await client.query('BEGIN');
        
        console.log('Creating automation_schedules...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS automation_schedules (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                account_ids TEXT[] NOT NULL,
                task_type TEXT NOT NULL,
                group_url TEXT,
                max_unfollow INTEGER DEFAULT 0,
                schedule_type TEXT NOT NULL, -- 'none', 'time', 'interval'
                schedule_value TEXT, -- pattern or milliseconds
                bullmq_job_id TEXT,
                status TEXT DEFAULT 'active', -- 'active', 'paused', 'completed'
                created_at TIMESTAMP DEFAULT NOW(),
                updated_at TIMESTAMP DEFAULT NOW()
            )
        `);

        console.log('Creating automation_job_history...');
        await client.query(`
            CREATE TABLE IF NOT EXISTS automation_job_history (
                id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                schedule_id UUID REFERENCES automation_schedules(id) ON DELETE SET NULL,
                account_id TEXT NOT NULL,
                task_type TEXT NOT NULL,
                status TEXT DEFAULT 'queued', -- 'queued', 'running', 'completed', 'failed'
                result_summary TEXT,
                error_message TEXT,
                started_at TIMESTAMP,
                finished_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT NOW()
            )
        `);

        // Add a column to logs to link with job_history if needed
        await client.query(`
            ALTER TABLE logs ADD COLUMN IF NOT EXISTS automation_job_id UUID;
        `);
        
        await client.query('COMMIT');
        console.log('\n✅ Automation Schedule Migration complete!');
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
