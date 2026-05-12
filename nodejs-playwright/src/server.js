require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const { getSettings, saveSettings } = require('./config');
const { addInviteJob, inviteQueue, addResearchJob } = require('./queue');
const { workerEvents } = require('./worker');
const researchRouter = require('./research-routes');
const { getQuota, setSocketEmitter } = require('./gemini');
const { researchQueue } = require('./queue');
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Ho_Chi_Minh';

const app = express();
const server = http.createServer(app);
const io = new Server(server);
setSocketEmitter(io);

app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.set('io', io);
app.use('/api/product-trends', researchRouter);
// Legacy alias so old frontend calls still work
app.use('/api/research', researchRouter);

function buildScheduleRepeatOptions(schedule) {
    if (!schedule || schedule.schedule_type === 'none') return {};
    if (schedule.schedule_type === 'time' && schedule.schedule_value) {
        const [hour, minute] = String(schedule.schedule_value).split(':').map(Number);
        return { repeat: { pattern: `${minute} ${hour} * * *`, tz: APP_TIMEZONE } };
    }
    if (schedule.schedule_type === 'interval' && schedule.schedule_value) {
        const hours = parseInt(schedule.schedule_value, 10);
        if (!Number.isInteger(hours) || hours < 1) return {};
        return { repeat: { every: hours * 60 * 60 * 1000 } };
    }
    return {};
}

function buildScheduleJobId(scheduleId, accountId) {
    return `schedule:${scheduleId}:${accountId}`;
}

async function enqueueScheduleAccountJob(schedule, accountId) {
    const repeatOptions = buildScheduleRepeatOptions(schedule);
    const isRecurring = schedule.schedule_type === 'time' || schedule.schedule_type === 'interval';
    const customOpts = {
        ...repeatOptions,
        jobId: isRecurring ? buildScheduleJobId(schedule.id, accountId) : undefined
    };
    await addInviteJob(accountId, {
        url: schedule.group_url || null,
        taskType: schedule.task_type || 'invite',
        maxUnfollow: schedule.max_unfollow ? parseInt(schedule.max_unfollow, 10) : 0,
        scheduleId: schedule.id
    }, customOpts);
}

async function enqueueScheduleJobs(schedule) {
    const accounts = Array.isArray(schedule.account_ids) ? schedule.account_ids : [];
    for (const accountId of accounts) {
        await enqueueScheduleAccountJob(schedule, accountId);
    }
}

// Broadcast stats from BullMQ
async function broadcastStats() {
    try {
        const queuedCount = await inviteQueue.getWaitingCount();
        const activeCount = await inviteQueue.getActiveCount();

        const dbPool = require('./db');
        const accs = await dbPool.query(
            'SELECT * FROM accounts WHERE deleted_at IS NULL ORDER BY created_at DESC'
        );

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
    const { accountId, groupUrl, taskType, maxUnfollow, scheduleType, scheduleTime, scheduleInterval, maxRuns } = req.body;
    if (!accountId) {
        return res.status(400).json({ error: 'Missing accountId' });
    }
    const normalizedTaskType = taskType || 'invite';
    const normalizedScheduleType = scheduleType || 'none';
    const runLimit = maxRuns === '' || maxRuns === undefined || maxRuns === null ? null : parseInt(maxRuns, 10);
    if (normalizedTaskType === 'invite' && !groupUrl) {
        return res.status(400).json({ error: 'Missing groupUrl for invite task' });
    }
    if (runLimit !== null && (!Number.isInteger(runLimit) || runLimit < 1)) {
        return res.status(400).json({ error: 'maxRuns must be a positive integer.' });
    }
    if (normalizedScheduleType === 'time' && !/^\d{2}:\d{2}$/.test(scheduleTime || '')) {
        return res.status(400).json({ error: 'Giờ hẹn không hợp lệ. Vui lòng chọn theo định dạng HH:mm.' });
    }

    try {
        const { setBotState } = require('./state');
        setBotState({ isPaused: false, isStopped: false }); // reset state when running new job

        if (inviteQueue) await inviteQueue.resume(); // Đảm bảo queue đang chạy

        const accounts = Array.isArray(accountId) ? accountId : [accountId];

        // 1. Create schedule record
        const dbPool = require('./db');
        const schedRes = await dbPool.query(
            `INSERT INTO automation_schedules
             (account_ids, task_type, group_url, max_unfollow, schedule_type, schedule_value, max_runs, status, updated_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, 'active', NOW()) RETURNING id`,
            [
                accounts,
                normalizedTaskType,
                groupUrl || null,
                maxUnfollow || 0,
                normalizedScheduleType,
                (normalizedScheduleType === 'time' ? scheduleTime : scheduleInterval),
                runLimit
            ]
        );
        const scheduleId = schedRes.rows[0].id;

        // 2. Add BullMQ job. Recurring schedules need one stable jobId per account.
        await enqueueScheduleJobs({
            id: scheduleId,
            account_ids: accounts,
            task_type: normalizedTaskType,
            group_url: groupUrl || null,
            max_unfollow: maxUnfollow || 0,
            schedule_type: normalizedScheduleType,
            schedule_value: normalizedScheduleType === 'time' ? scheduleTime : scheduleInterval
        });

        broadcastStats();
        res.json({ success: true, scheduleId });
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

app.post('/api/admin/reset-cooldown', (req, res) => {
    if (typeof researchRouter.resetCooldowns === 'function') {
        researchRouter.resetCooldowns();
    }
    const state = typeof researchRouter.getCooldownState === 'function'
        ? researchRouter.getCooldownState()
        : null;
    if (state) io.emit('cooldown_update', state);
    res.json({ success: true, message: 'Cooldown reset.' });
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

// Ensure the repeatable research job is queued for 08:00 AM daily
addResearchJob().catch(console.error);

// Pass worker events to socket.io
workerEvents.on('cron_status', (data) => {
    io.emit('cron_status', data);
});

// Broadcast quota every 10s
setInterval(async () => {
    try {
        const quota = await getQuota();
        if (quota) io.emit('quota_update', quota);
    } catch(e) {}
}, 10000);

const PORT = process.env.PORT || 3000;
console.log(`📡 Đang khởi động server trên port ${PORT}...`);
server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`❌ LỖI: Port ${PORT} đã bị chiếm dụng bởi một ứng dụng khác.`);
        console.error(`Vui lòng đóng ứng dụng đang dùng port ${PORT} hoặc đổi port trong file .env (PORT=xxxx)`);
        process.exit(1);
    } else {
        console.error(`❌ LỖI Server:`, err);
    }
});

async function ensureAutomationSchema() {
    const dbPool = require('./db');
    await dbPool.query(`
        CREATE TABLE IF NOT EXISTS automation_schedules (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            account_ids TEXT[] NOT NULL,
            task_type TEXT NOT NULL,
            group_url TEXT,
            max_unfollow INTEGER DEFAULT 0,
            schedule_type TEXT NOT NULL DEFAULT 'none',
            schedule_value TEXT,
            bullmq_job_id TEXT,
            status TEXT DEFAULT 'active',
            max_runs INTEGER,
            run_count INTEGER DEFAULT 0,
            success_count INTEGER DEFAULT 0,
            failed_count INTEGER DEFAULT 0,
            last_run_at TIMESTAMP,
            completed_at TIMESTAMP,
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await dbPool.query(`ALTER TABLE automation_schedules ADD COLUMN IF NOT EXISTS max_runs INTEGER`);
    await dbPool.query(`ALTER TABLE automation_schedules ADD COLUMN IF NOT EXISTS run_count INTEGER DEFAULT 0`);
    await dbPool.query(`ALTER TABLE automation_schedules ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0`);
    await dbPool.query(`ALTER TABLE automation_schedules ADD COLUMN IF NOT EXISTS failed_count INTEGER DEFAULT 0`);
    await dbPool.query(`ALTER TABLE automation_schedules ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMP`);
    await dbPool.query(`ALTER TABLE automation_schedules ADD COLUMN IF NOT EXISTS completed_at TIMESTAMP`);
    await dbPool.query(`ALTER TABLE automation_schedules ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT NOW()`);
    await dbPool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS schedule_id UUID`);
    await dbPool.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS result_summary TEXT`);
    await dbPool.query(`
        UPDATE automation_schedules s
        SET run_count = stats.run_count,
            success_count = stats.success_count,
            failed_count = stats.failed_count,
            last_run_at = stats.last_run_at,
            updated_at = NOW()
        FROM (
            SELECT schedule_id,
                   COUNT(*)::INTEGER as run_count,
                   COUNT(*) FILTER (WHERE status = 'completed')::INTEGER as success_count,
                   COUNT(*) FILTER (WHERE status = 'failed')::INTEGER as failed_count,
                   MAX(started_at) as last_run_at
            FROM tasks
            WHERE schedule_id IS NOT NULL
            GROUP BY schedule_id
        ) stats
        WHERE s.id = stats.schedule_id
          AND (COALESCE(s.run_count, 0) = 0 OR s.last_run_at IS NULL)
    `);
    await dbPool.query(`
        UPDATE automation_schedules
        SET status = 'completed',
            completed_at = COALESCE(completed_at, last_run_at, NOW()),
            updated_at = NOW()
        WHERE schedule_type = 'none'
          AND COALESCE(run_count, 0) > 0
          AND status = 'active'
    `);
}

// Automation Schedules & History
app.get('/api/automation/schedules', async (req, res) => {
    try {
        const { date, type, status } = req.query;
        const dbPool = require('./db');
        const params = [];
        const where = [];
        if (type && type !== 'all') {
            params.push(type);
            where.push(`s.task_type = $${params.length}`);
        }
        if (status && status !== 'all') {
            params.push(status);
            where.push(`s.status = $${params.length}`);
        }
        if (date) {
            params.push(date);
            where.push(`DATE(s.created_at AT TIME ZONE '${APP_TIMEZONE}') = $${params.length}`);
        }
        const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
        const result = await dbPool.query(`
            SELECT s.*,
                   COALESCE(s.run_count, 0) as run_count,
                   COALESCE(s.success_count, 0) as success_count,
                   COALESCE(s.failed_count, 0) as failed_count,
                   (SELECT COUNT(*) FROM tasks t WHERE t.schedule_id = s.id) as total_tasks,
                   (SELECT MAX(finished_at) FROM tasks t WHERE t.schedule_id = s.id) as last_run
            FROM automation_schedules s
            ${whereSql}
            ORDER BY s.created_at DESC
        `, params);
        res.json({ success: true, data: result.rows });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/automation/summary', async (req, res) => {
    try {
        const { date, type } = req.query;
        const dbPool = require('./db');
        const params = [];
        const taskWhere = [];
        const scheduleWhere = [];
        if (date) {
            params.push(date);
            taskWhere.push(`DATE(t.started_at AT TIME ZONE '${APP_TIMEZONE}') = $${params.length}`);
            scheduleWhere.push(`DATE(s.created_at AT TIME ZONE '${APP_TIMEZONE}') = $${params.length}`);
        }
        if (type && type !== 'all') {
            params.push(type);
            taskWhere.push(`t.type = $${params.length}`);
            scheduleWhere.push(`s.task_type = $${params.length}`);
        }
        const taskWhereSql = taskWhere.length ? `WHERE ${taskWhere.join(' AND ')}` : '';
        const scheduleWhereSql = scheduleWhere.length ? `WHERE ${scheduleWhere.join(' AND ')}` : '';
        const summary = await dbPool.query(`
            SELECT COUNT(*) as task_runs,
                   COUNT(*) FILTER (WHERE status = 'completed') as completed,
                   COUNT(*) FILTER (WHERE status = 'failed') as failed,
                   COUNT(*) FILTER (WHERE status = 'running') as running,
                   COUNT(DISTINCT account_id) as accounts_touched
            FROM tasks t
            ${taskWhereSql}
        `, params);
        const schedules = await dbPool.query(`
            SELECT COUNT(*) as total_schedules,
                   COUNT(*) FILTER (WHERE status = 'active') as active_schedules,
                   COUNT(*) FILTER (WHERE status = 'completed') as completed_schedules,
                   COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_schedules
            FROM automation_schedules s
            ${scheduleWhereSql}
        `, params);
        const byType = await dbPool.query(`
            SELECT type, status, COUNT(*) as count
            FROM tasks t
            ${taskWhereSql}
            GROUP BY type, status
            ORDER BY type, status
        `, params);
        res.json({
            success: true,
            filters: { date: date || null, type: type || 'all' },
            summary: summary.rows[0],
            schedules: schedules.rows[0],
            by_type: byType.rows
        });
    } catch(err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

app.get('/api/automation/history', async (req, res) => {
    try {
        const { scheduleId, accountId, date, type, status, limit = 50 } = req.query;
        const dbPool = require('./db');
        let query = `SELECT t.*, a.name as account_name
                     FROM tasks t
                     JOIN accounts a ON t.account_id = a.id`;
        let params = [];
        let whereClauses = [];

        if (scheduleId) {
            whereClauses.push(`t.schedule_id = $${params.length + 1}`);
            params.push(scheduleId);
        }
        if (accountId) {
            whereClauses.push(`t.account_id = $${params.length + 1}`);
            params.push(accountId);
        }
        if (date) {
            whereClauses.push(`DATE(t.started_at AT TIME ZONE '${APP_TIMEZONE}') = $${params.length + 1}`);
            params.push(date);
        }
        if (type && type !== 'all') {
            whereClauses.push(`t.type = $${params.length + 1}`);
            params.push(type);
        }
        if (status && status !== 'all') {
            whereClauses.push(`t.status = $${params.length + 1}`);
            params.push(status);
        }

        if (whereClauses.length) {
            query += ' WHERE ' + whereClauses.join(' AND ');
        }

        query += ` ORDER BY t.started_at DESC LIMIT $${params.length + 1}`;
        params.push(parseInt(limit));

        const result = await dbPool.query(query, params);
        res.json({ success: true, data: result.rows });
    } catch(err) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/api/automation/schedules/:id', async (req, res) => {
    try {
        const scheduleId = req.params.id;
        const dbPool = require('./db');

        // 1. Get schedule info to find repeatable jobs
        const schedRes = await dbPool.query('SELECT * FROM automation_schedules WHERE id = $1', [scheduleId]);
        if (schedRes.rows.length === 0) {
            return res.status(404).json({ error: 'Không tìm thấy lịch hẹn.' });
        }

        const schedule = schedRes.rows[0];

        // 2. Remove repeatable jobs from BullMQ if it was a recurring schedule
        if (schedule.schedule_type === 'time' || schedule.schedule_type === 'interval') {
            const repeatableJobs = await inviteQueue.getRepeatableJobs();
            for (const job of repeatableJobs) {
                // We check if the job name is 'invite' and if the repeat options match
                // Note: BullMQ repeat keys are complex, but we can try to find them by scheduleId in the job's next execution if we had set it.
                // Since we didn't set a unique jobId for repeatable jobs, we might need to be careful.
                // However, we can check the jobs in the queue.
            }

            // Simpler approach for now: find all repeatable jobs and remove those that match our schedule criteria
            // or just rely on the worker checking the DB (but that's not ideal for cleaning up the queue UI).

            // For now, let's just delete from DB and I'll add a check in the worker.
        }

        await dbPool.query(
            `UPDATE automation_schedules
             SET status = 'cancelled', updated_at = NOW()
             WHERE id = $1`,
            [scheduleId]
        );
        res.json({ success: true });
    } catch(err) {
        console.error(err);
        res.status(500).json({ error: err.message });
    }
});


async function clearQueueOnStartup() {
    try {
        const dbPool = require('./db');
        await dbPool.query(
            "UPDATE tasks SET status = 'failed', error = 'Cancelled by server restart', finished_at = NOW() WHERE status IN ('pending', 'active', 'running')"
        );
        if (inviteQueue) {
            await inviteQueue.obliterate({ force: true }).catch(() => {});
        }
        console.log('🧹 Đã tự động dọn dẹp hàng đợi cũ do server khởi động lại.');
    } catch(err) {
        console.error('Lỗi khi dọn dẹp hàng đợi:', err.message);
    }
}

async function rehydrateActiveSchedules() {
    const dbPool = require('./db');
    const result = await dbPool.query(`
        SELECT *
        FROM automation_schedules
        WHERE status = 'active'
          AND schedule_type IN ('time', 'interval')
          AND (max_runs IS NULL OR COALESCE(run_count, 0) < max_runs)
        ORDER BY created_at ASC
    `);
    let added = 0;
    for (const schedule of result.rows) {
        await enqueueScheduleJobs(schedule);
        added += Array.isArray(schedule.account_ids) ? schedule.account_ids.length : 0;
    }
    if (added > 0) {
        console.log(`[Scheduler] Đã khôi phục ${added} repeat jobs từ ${result.rows.length} lịch active.`);
    }
}

// Trigger once on startup (using repeatable jobId logic to avoid double runs on restart)
async function triggerStartupResearch() {
    const date = new Date().toISOString().split('T')[0];
    await researchQueue.add('startup-research', {}, {
        jobId: `trend_startup_${date}`
    }).catch(() => {}); // Skip if already ran today
}

ensureAutomationSchema().then(() => clearQueueOnStartup()).then(() => rehydrateActiveSchedules()).then(() => {
    triggerStartupResearch();
    server.listen(PORT, '0.0.0.0', () => {
        console.log(`
🚀 ===================================================
🚀 FAuto Server is running!
🚀 URL: http://localhost:${PORT}
🚀 Network: http://0.0.0.0:${PORT}
🚀 ===================================================
        `);
    });
});
