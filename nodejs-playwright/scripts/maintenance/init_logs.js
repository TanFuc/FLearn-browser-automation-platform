const pool = require('../../src/db');

async function run() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS logs (
            id SERIAL PRIMARY KEY,
            account_id VARCHAR(50),
            schedule_id UUID,
            task_id INTEGER,
            type VARCHAR(20) DEFAULT 'info',
            message TEXT NOT NULL,
            created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
    `);
    await pool.query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS schedule_id UUID`);
    await pool.query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS task_id INTEGER`);
    await pool.query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS type VARCHAR(20) DEFAULT 'info'`);
    await pool.query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS message TEXT`);
    await pool.query(`ALTER TABLE logs ADD COLUMN IF NOT EXISTS created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()`);
    console.log('Logs table ready');
}

run()
    .then(() => process.exit(0))
    .catch(err => {
        console.error(err);
        process.exit(1);
    });
