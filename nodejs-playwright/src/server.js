require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const cron = require('node-cron');
const { getSettings, saveSettings } = require('./config');
const { addInviteJob, inviteQueue } = require('./queue');
const { workerEvents } = require('./worker');
const researchRouter = require('./research-routes');
const { runDailyResearch } = require('./research-service');
const { getQuota } = require('./gemini');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/api/research', researchRouter);

// Broadcast stats from BullMQ
async function broadcastStats() {
    try {
        const queuedCount = await inviteQueue.getWaitingCount();
        const activeCount = await inviteQueue.getActiveCount();
        
        const dbPool = require('./db');
        const accs = await dbPool.query('SELECT * FROM accounts ORDER BY created_at DESC');
        
        io.emit('stats', { 
            queued: queuedCount, 
            active: activeCount,
            accounts: accs.rows
        });
    } catch(e) {
        console.log("Error getting queue stats", e);
    }
}

// Update stats periodically
setInterval(broadcastStats, 3000);

// Helper for system logs
function systemLog(message, type = 'info') {
    const data = { accountId: 'system', message, type };
    io.emit('log', data);
    const dbPool = require('./db');
    dbPool.query('INSERT INTO logs (account_id, type, message) VALUES ($1, $2, $3)', [data.accountId, data.type, data.message]).catch(() => {});
}

// Listen to worker events
workerEvents.on('log', (data) => {
    console.log(`[${data.accountId}] ${data.message}`);
    const dbPool = require('./db');
    dbPool.query('INSERT INTO logs (account_id, type, message) VALUES ($1, $2, $3)', [data.accountId, data.type || 'info', data.message]).catch(() => {});
    io.emit('log', data);
});

let sentCount = 0;
let unfollowCount = 0;
workerEvents.on('stats_inc', (data) => {
    if (data && data.type === 'unfollow') {
        unfollowCount++;
        io.emit('stats', { unfollows: unfollowCount });
    } else {
        sentCount++;
        io.emit('stats', { sent: sentCount });
    }
});

app.get('/api/config', (req, res) => {
    res.json(getSettings());
});

app.post('/api/config', (req, res) => {
    saveSettings(req.body);
    res.json({ success: true });
});

app.post('/api/run', async (req, res) => {
    const { accountId, groupUrl, taskType, maxUnfollow } = req.body;
    if (!accountId) {
        return res.status(400).json({ error: 'Missing accountId' });
    }
    if (taskType !== 'unfollow' && !groupUrl) {
        return res.status(400).json({ error: 'Missing groupUrl for invite task' });
    }

    try {
        const { setBotState } = require('./state');
        setBotState({ isPaused: false, isStopped: false }); // reset state when running new job

        if (inviteQueue) await inviteQueue.resume(); // Đảm bảo queue đang chạy

        const accounts = Array.isArray(accountId) ? accountId : [accountId];
        for (const acc of accounts) {
            await addInviteJob(acc, { 
                url: groupUrl, 
                taskType: taskType || 'invite',
                maxUnfollow: maxUnfollow ? parseInt(maxUnfollow, 10) : 0
            });
        }
        
        broadcastStats();
        res.json({ success: true });
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});

// Control APIs
app.post('/api/pause', (req, res) => {
    const { setBotState } = require('./state');
    setBotState({ isPaused: true });
    systemLog('⏸ Hệ thống đang TẠM DỪNG (Sẽ dừng sau khi hoàn tất lượt tương tác hiện tại).', 'warning');
    res.json({ success: true });
});

app.post('/api/resume', (req, res) => {
    const { setBotState } = require('./state');
    setBotState({ isPaused: false });
    systemLog('▶️ Hệ thống đã TIẾP TỤC.', 'success');
    res.json({ success: true });
});

app.post('/api/stop', async (req, res) => {
    const { setBotState } = require('./state');
    setBotState({ isStopped: true, isPaused: false });
    systemLog('⏹ Hệ thống đang DỪNG HẲN (Sẽ kết thúc phiên làm việc).', 'error');
    
    // Xóa toàn bộ hàng đợi và tạm dừng queue để tránh retry
    if (inviteQueue) {
        await inviteQueue.drain(true).catch(() => {}); // Xóa hết jobs đang đợi
        await inviteQueue.pause().catch(() => {});
    }
    
    res.json({ success: true });
});

// Get recent logs
app.get('/api/logs', async (req, res) => {
    try {
        const dbPool = require('./db');
        const result = await dbPool.query('SELECT account_id, type, message, created_at FROM logs ORDER BY created_at DESC LIMIT 200');
        res.json(result.rows.reverse());
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Accounts API — only active (non-soft-deleted) accounts
app.get('/api/accounts', async (req, res) => {
    try {
        const dbPool = require('./db');
        const result = await dbPool.query(
            'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at DESC'
        );
        res.json(result.rows);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Soft-deleted accounts list
app.get('/api/accounts/deleted', async (req, res) => {
    try {
        const dbPool = require('./db');
        const result = await dbPool.query(
            'SELECT * FROM accounts WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC'
        );
        res.json(result.rows);
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Soft Delete Account
app.delete('/api/accounts/:id', async (req, res) => {
    try {
        const dbPool = require('./db');
        await dbPool.query(
            'UPDATE accounts SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1',
            [req.params.id]
        );
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Restore Soft-Deleted Account
app.post('/api/accounts/:id/restore', async (req, res) => {
    try {
        const dbPool = require('./db');
        await dbPool.query(
            'UPDATE accounts SET deleted_at = NULL, updated_at = NOW() WHERE id = $1',
            [req.params.id]
        );
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Hard Delete Account (archive to audit table, then remove row)
app.delete('/api/accounts/:id/hard', async (req, res) => {
    try {
        const dbPool = require('./db');
        // 1. Copy to audit table
        await dbPool.query(`
            INSERT INTO deleted_accounts (id, name, proxy, fb_email, group_url, daily_limit, invites_sent_today, unfollows_today, deleted_at, hard_deleted_at, created_at)
            SELECT id, name, proxy, fb_email, group_url, daily_limit, invites_sent_today, unfollows_today, deleted_at, NOW(), created_at
            FROM accounts WHERE id = $1
        `, [req.params.id]);
        // 2. Set hard_deleted_at marker before deletion
        await dbPool.query('UPDATE accounts SET hard_deleted_at = NOW() WHERE id = $1', [req.params.id]);
        // 3. Actually delete the row
        await dbPool.query('DELETE FROM accounts WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Update Account (PUT)
app.put('/api/accounts/:id', async (req, res) => {
    const { name, proxy, daily_limit, group_url, fb_email, fb_password } = req.body;
    try {
        const dbPool = require('./db');
        await dbPool.query(
            `UPDATE accounts SET
                name = $1,
                proxy = $2,
                daily_limit = $3,
                group_url = $4,
                fb_email = $5,
                fb_password = $6,
                updated_at = NOW()
             WHERE id = $7`,
            [name || null, proxy || null, daily_limit || 50, group_url || null, fb_email || null, fb_password || null, req.params.id]
        );
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});


// Open Browser manually
app.post('/api/accounts/:id/browser', async (req, res) => {
    try {
        const { createOrLoadContext } = require('./browser');
        const dbPool = require('./db');
        
        const accResult = await dbPool.query('SELECT proxy FROM accounts WHERE id = $1', [req.params.id]);
        if (accResult.rows.length === 0) {
            return res.status(404).json({ error: 'Không tìm thấy tài khoản.' });
        }
        
        const proxy = accResult.rows[0].proxy;
        
        // Cố gắng mở trình duyệt (sẽ lỗi nếu worker đang chạy account này)
        const { page } = await createOrLoadContext(req.params.id, proxy, false);
        await page.goto('https://facebook.com');
        
        res.json({ success: true });
    } catch(err) {
        if (err.message.includes('lock')) {
            res.status(400).json({ error: 'Trình duyệt của tài khoản này đang được sử dụng (Hệ thống đang chạy task). Vui lòng dừng task trước khi mở tay.' });
        } else {
            res.status(500).json({ error: `Lỗi mở trình duyệt: ${err.message}` });
        }
    }
});

app.post('/api/accounts', async (req, res) => {
    const { id, name, proxy, daily_limit, group_url, fb_email, fb_password } = req.body;
    try {
        const dbPool = require('./db');
        await dbPool.query(
            `INSERT INTO accounts (id, name, proxy, daily_limit, group_url, fb_email, fb_password) VALUES ($1, $2, $3, $4, $5, $6, $7)
             ON CONFLICT (id) DO UPDATE SET
             name = EXCLUDED.name,
             proxy = EXCLUDED.proxy,
             daily_limit = EXCLUDED.daily_limit,
             group_url = EXCLUDED.group_url,
             fb_email = EXCLUDED.fb_email,
             fb_password = EXCLUDED.fb_password`,
            [id, name || null, proxy || null, daily_limit || 50, group_url || null, fb_email || null, fb_password || null]
        );
        res.json({ success: true });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

// Daily research cron — runs at 02:00 AM every day
cron.schedule('0 2 * * *', async () => {
    console.log('[Cron] Running daily research job...');
    try {
        await runDailyResearch();
        io.emit('cron_status', { status: 'success', time: new Date().toISOString() });
    } catch(e) {
        io.emit('cron_status', { status: 'error', message: e.message });
    }
});

// Broadcast quota every 10s
setInterval(async () => {
    try {
        const quota = await getQuota();
        if (quota) io.emit('quota_update', quota);
    } catch(e) {}
}, 10000);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running at http://localhost:${PORT}`);
});

