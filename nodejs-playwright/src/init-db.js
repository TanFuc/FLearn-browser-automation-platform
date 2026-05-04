require('dotenv').config();
const db = require('./db');

async function initDB() {
  console.log("Creating tables if they don't exist...");

  const accountsTable = `
  CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    status TEXT DEFAULT 'active',
    proxy TEXT,
    group_url TEXT,
    fb_email TEXT,
    fb_password TEXT,
    daily_limit INTEGER DEFAULT 50,
    invites_sent_today INTEGER DEFAULT 0,
    last_run_at TIMESTAMP,
    error_count INTEGER DEFAULT 0,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
  );
  `;

  const tasksTable = `
  CREATE TABLE IF NOT EXISTS tasks (
    id SERIAL PRIMARY KEY,
    account_id TEXT,
    type TEXT,
    payload JSONB,
    status TEXT DEFAULT 'pending',
    attempts INTEGER DEFAULT 0,
    max_attempts INTEGER DEFAULT 3,
    scheduled_at TIMESTAMP,
    started_at TIMESTAMP,
    finished_at TIMESTAMP,
    error TEXT
  );
  `;

  try {
    await db.query(accountsTable);
    console.log("✅ Created 'accounts' table.");
    
    await db.query(tasksTable);
    console.log("✅ Created 'tasks' table.");
    
    console.log("Database initialized successfully!");
  } catch (error) {
    console.error("❌ Error initializing database:", error);
  } finally {
    process.exit();
  }
}

initDB();
