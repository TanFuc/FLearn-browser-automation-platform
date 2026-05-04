require('dotenv').config();
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const db = require('./db');
const { createOrLoadContext } = require('./browser');
const { autoInviteTask, autoUnfollowTask } = require('./tasks');
const { EventEmitter } = require('events');

const workerEvents = new EventEmitter();

const redisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null
};

if (process.env.REDIS_PASSWORD) {
  redisOptions.password = process.env.REDIS_PASSWORD;
}

const connection = new IORedis(redisOptions);

const worker = new Worker('invite-queue', async job => {
  const { accountId, payload } = job.data;
  const taskType = payload.taskType || 'invite';

  // Insert account if it doesn't exist so we don't crash the worker
  await db.query(
    `INSERT INTO accounts (id) VALUES ($1) ON CONFLICT (id) DO NOTHING`,
    [accountId]
  );

  const res = await db.query(
    `SELECT * FROM accounts WHERE id = $1`,
    [accountId]
  );

  const account = res.rows[0];
  if (!account) throw new Error('Account not found');

  // Insert task into DB
  const taskRes = await db.query(
    `INSERT INTO tasks (account_id, type, payload, status, started_at) 
     VALUES ($1, $2, $3, 'running', NOW()) RETURNING id`,
    [accountId, taskType || 'invite', payload]
  );
  const taskId = taskRes.rows[0].id;

  const emitLog = (accId, msg, type = 'info') => {
    workerEvents.emit('log', { accountId: accId, message: msg, type });
  };
  const incrementStats = (type = 'invite') => {
    workerEvents.emit('stats_inc', { type });
    if (type === 'unfollow') {
        db.query(`UPDATE accounts SET unfollows_today = COALESCE(unfollows_today, 0) + 1 WHERE id = $1`, [accountId]).catch(err => console.log('Error updating stats', err));
    } else {
        db.query(`UPDATE accounts SET invites_sent_today = COALESCE(invites_sent_today, 0) + 1 WHERE id = $1`, [accountId]).catch(err => console.log('Error updating stats', err));
    }
  };

  let context, page;
  try {
    const accountResult = await db.query('SELECT proxy FROM accounts WHERE id = $1', [accountId]);
    const proxyString = accountResult.rows.length > 0 ? accountResult.rows[0].proxy : null;

    const contextData = await createOrLoadContext(accountId, proxyString, false);
    context = contextData.context;
    page = contextData.page;

    emitLog(accountId, `🚀 Chạy job cho account: ${accountId}`, 'system');
    
    if (taskType === 'unfollow') {
        emitLog(accountId, `🚀 Bắt đầu Hủy Theo Dõi (Limit: ${payload.maxUnfollow || 'Tất cả'})`);
        await autoUnfollowTask(page, context, account, payload, emitLog, incrementStats);
    } else {
        emitLog(accountId, `Điều hướng tới: ${payload.url}`);
        await page.goto(payload.url, { waitUntil: 'domcontentloaded' });
        await autoInviteTask(page, context, account, payload.url, emitLog, incrementStats);
    }

    await db.query(
      `UPDATE accounts 
       SET last_run_at = NOW()
       WHERE id = $1`,
      [accountId]
    );
    
    await db.query(`UPDATE tasks SET status = 'completed', finished_at = NOW() WHERE id = $1`, [taskId]);

  } catch (err) {
    await db.query(
      `UPDATE accounts 
       SET error_count = error_count + 1
       WHERE id = $1`,
      [accountId]
    );
    await db.query(`UPDATE tasks SET status = 'failed', error = $1, finished_at = NOW() WHERE id = $2`, [err.message, taskId]);

    throw err;
  } finally {
    // Thêm delay ngẫu nhiên trước khi đóng
    await new Promise(r => setTimeout(r, 2000));
    if (context) {
        await context.close();
        emitLog(accountId, `Đã đóng trình duyệt.`);
    }
  }
}, { 
    connection,
    concurrency: parseInt(process.env.MAX_CONCURRENCY || 5)
});

worker.on('completed', job => {
  console.log(`✅ Job done: ${job.id}`);
  workerEvents.emit('log', { accountId: job.data.accountId, message: `✅ Tác vụ hoàn thành (Job ID: ${job.id})`, type: 'success' });
});

worker.on('failed', (job, err) => {
  console.log(`❌ Job failed: ${job.id}`, err.message);
  workerEvents.emit('log', { accountId: job.data.accountId, message: `❌ Tác vụ thất bại: ${err.message}`, type: 'error' });
});

module.exports = { worker, workerEvents };
