const pool = require('../../src/db');
pool.query(`
    CREATE TABLE IF NOT EXISTS logs (
        id SERIAL PRIMARY KEY,
        account_id VARCHAR(50),
        type VARCHAR(20) DEFAULT 'info',
        message TEXT NOT NULL,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
`).then(() => {
    console.log("Logs table created");
    process.exit(0);
}).catch(console.error);
