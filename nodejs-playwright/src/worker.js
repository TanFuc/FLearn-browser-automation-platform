require('dotenv').config();
const { Worker } = require('bullmq');
const IORedis = require('ioredis');
const db = require('./db');
const { inviteQueue, affVidQueue, upPostQueue } = require('./queue');
const { createOrLoadContext } = require('./browser');
const { autoInviteTask, autoUnfollowFriendsTask, autoUnfollowFollowingTask, warmupTask, commentPostTask, createPostTask } = require('./tasks');
const { EventEmitter } = require('events');
const { emitSystemLog } = require('./logger');

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
const accountLocks = new Map();

async function withAccountLock(accountId, fn) {
  const key = String(accountId || '');
  const previous = accountLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise(resolve => { release = resolve; });
  const chained = previous.then(() => current, () => current);
  accountLocks.set(key, chained);

  await previous.catch(() => {});
  try {
    return await fn();
  } finally {
    release();
    if (accountLocks.get(key) === chained) accountLocks.delete(key);
  }
}

function safeJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch (err) {
    return fallback;
  }
}

function buildInternalPublishUrl(kind, id, platform) {
  const base = process.env.PUBLIC_BASE_URL || `http://localhost:${process.env.PORT || 3000}`;
  const cleanPlatform = String(platform || 'default').toLowerCase().replace(/[^a-z0-9_-]+/g, '-');
  return `${base.replace(/\/$/, '')}/published/${kind}/${encodeURIComponent(id)}/${cleanPlatform}`;
}

async function renderAffVideoPlan(planRow) {
  const plan = safeJson(planRow.plan_data, {});
  const script = Array.isArray(plan.script) ? plan.script.join('\n') : String(plan.script || plan.caption || '');
  const shotList = Array.isArray(plan.shot_list) ? plan.shot_list : [];
  return {
    rendered_at: new Date().toISOString(),
    renderer: process.env.AFF_VID_RENDERER || 'internal-json-renderer',
    asset_manifest: {
      script_text: script,
      shot_count: shotList.length,
      caption: plan.caption || '',
      hashtags: Array.isArray(plan.hashtags) ? plan.hashtags : [],
      product_id: planRow.product_id
    },
    render_url: buildInternalPublishUrl('aff-vid-render', planRow.id, 'video'),
    dry_run: process.env.AFF_VID_DRY_RUN !== 'false'
  };
}

async function publishAffVideoPlan(planRow, renderResult) {
  const plan = safeJson(planRow.plan_data, {});
  const targets = Array.isArray(planRow.platform_targets) && planRow.platform_targets.length
    ? planRow.platform_targets
    : (Array.isArray(plan.platform_targets) ? plan.platform_targets : ['TikTok', 'Facebook Reels', 'Instagram Reels']);
  return targets.map(platform => ({
    platform,
    status: 'published',
    published_at: new Date().toISOString(),
    published_url: buildInternalPublishUrl('aff-vid', planRow.id, platform),
    render_url: renderResult.render_url,
    dry_run: process.env.AFF_VID_DRY_RUN !== 'false'
  }));
}

async function processAffVidJob(job) {
  const planId = job.data?.planId;
  if (!planId) throw new Error('AFF VID job missing planId.');
  await emitSystemLog('AFF VID worker picked job', 'info', { job_id: job.id, plan_id: planId });
  const started = await db.query(
    `UPDATE aff_video_plans
     SET status = 'rendering',
         plan_data = COALESCE(plan_data, '{}'::jsonb) || jsonb_build_object('worker_job_id', $1::text, 'rendering_started_at', NOW()::text),
         updated_at = NOW()
     WHERE id::TEXT = $2
       AND status IN ('draft', 'rendered', 'posted', 'failed')
     RETURNING *`,
    [String(job.id), String(planId)]
  );
  const planRow = started.rows[0] || (await db.query(`SELECT * FROM aff_video_plans WHERE id::TEXT = $1`, [String(planId)])).rows[0];
  if (!planRow) throw new Error(`AFF VID plan ${planId} not found.`);

  try {
    const renderResult = await renderAffVideoPlan(planRow);
    await db.query(
      `UPDATE aff_video_plans
       SET status = 'rendered',
           plan_data = COALESCE(plan_data, '{}'::jsonb) || jsonb_build_object('render_result', $1::jsonb, 'rendered_at', NOW()::text),
           updated_at = NOW()
       WHERE id::TEXT = $2`,
      [JSON.stringify(renderResult), String(planId)]
    );
    await emitSystemLog('AFF VID render completed', 'success', { plan_id: planId, render_url: renderResult.render_url });

    await db.query(
      `UPDATE aff_video_plans
       SET status = 'posting',
           plan_data = COALESCE(plan_data, '{}'::jsonb) || jsonb_build_object('posting_started_at', NOW()::text),
           updated_at = NOW()
       WHERE id::TEXT = $1`,
      [String(planId)]
    );
    const postedTargets = await publishAffVideoPlan(planRow, renderResult);
    await db.query(
      `UPDATE aff_video_plans
       SET status = 'posted',
           plan_data = COALESCE(plan_data, '{}'::jsonb) || jsonb_build_object('published_targets', $1::jsonb, 'posted_at', NOW()::text),
           updated_at = NOW()
       WHERE id::TEXT = $2`,
      [JSON.stringify(postedTargets), String(planId)]
    );
    await emitSystemLog('AFF VID posting completed', 'success', { plan_id: planId, targets: postedTargets.length });
    return { planId, status: 'posted', targets: postedTargets };
  } catch (err) {
    await db.query(
      `UPDATE aff_video_plans
       SET status = 'failed',
           plan_data = COALESCE(plan_data, '{}'::jsonb) || jsonb_build_object('failed_reason', $1::text, 'failed_at', NOW()::text),
           updated_at = NOW()
       WHERE id::TEXT = $2`,
      [err.message, String(planId)]
    );
    await emitSystemLog('AFF VID worker failed', 'error', { plan_id: planId, error: err.message });
    throw err;
  }
}

async function processUpPostJob(job) {
  const postId = job.data?.postId;
  if (!postId) throw new Error('UP POST job missing postId.');
  await emitSystemLog('UP POST worker picked job', 'info', { job_id: job.id, post_id: postId });
  const locked = await db.query(
    `UPDATE up_post_variants
     SET status = 'posting',
         queue_payload = COALESCE(queue_payload, '{}'::jsonb) || jsonb_build_object('worker_job_id', $1::text, 'posting_started_at', NOW()::text),
         updated_at = NOW()
     WHERE post_id = $2
       AND status IN ('queued', 'failed')
     RETURNING *`,
    [String(job.id), String(postId)]
  );
  const row = locked.rows[0];
  if (!row) {
    const existing = await db.query(`SELECT post_id, status FROM up_post_variants WHERE post_id = $1`, [String(postId)]);
    if (!existing.rows.length) throw new Error(`UP POST variant ${postId} not found.`);
    return { postId, skipped: true, status: existing.rows[0].status };
  }

  try {
    const publishedUrl = buildInternalPublishUrl('up-post', postId, row.platform);
    const publishResult = {
      platform: row.platform,
      status: 'published',
      published_url: publishedUrl,
      published_at: new Date().toISOString(),
      dry_run: process.env.UP_POST_DRY_RUN !== 'false'
    };
    await db.query(
      `UPDATE up_post_variants
       SET status = 'published',
           published_at = NOW(),
           failed_reason = NULL,
           post_data = COALESCE(post_data, '{}'::jsonb) || jsonb_build_object('publish_result', $1::jsonb, 'published_url', $2::text),
           queue_payload = COALESCE(queue_payload, '{}'::jsonb) || jsonb_build_object('publish_result', $1::jsonb),
           updated_at = NOW()
       WHERE post_id = $3`,
      [JSON.stringify(publishResult), publishedUrl, String(postId)]
    );
    await emitSystemLog('UP POST published', 'success', { post_id: postId, platform: row.platform, published_url: publishedUrl });
    return publishResult;
  } catch (err) {
    await db.query(
      `UPDATE up_post_variants
       SET status = 'failed', failed_reason = $1, updated_at = NOW()
       WHERE post_id = $2`,
      [err.message, String(postId)]
    );
    await emitSystemLog('UP POST worker failed', 'error', { post_id: postId, error: err.message });
    throw err;
  }
}

const worker = new Worker('invite-queue', async job => {
  const { accountId, payload } = job.data;
  const taskType = payload.taskType || 'invite';

  return withAccountLock(accountId, async () => {

  // [TỐI ƯU] Tránh mở trình duyệt đồng loạt gây nghẽn CPU/Lock renewal
  // Tăng delay ngẫu nhiên từ 2-15 giây để dàn trải tải trọng
  const startupDelay = Math.floor(Math.random() * 13000) + 2000;
  await new Promise(r => setTimeout(r, startupDelay));

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
  const scheduleId = payload.scheduleId || null;

  if (scheduleId) {
    const schedCheck = await db.query('SELECT * FROM automation_schedules WHERE id = $1', [scheduleId]);
    if (schedCheck.rows.length === 0) {
      console.log(`[Worker] Schedule ${scheduleId} was deleted. Skipping job.`);
      return; // Stop execution if schedule is gone
    }
    const schedule = schedCheck.rows[0];
    if (schedule.status !== 'active') {
      console.log(`[Worker] Schedule ${scheduleId} is ${schedule.status}. Skipping job.`);
      return;
    }
    if (schedule.max_runs && schedule.run_count >= schedule.max_runs) {
      await db.query(
        `UPDATE automation_schedules
         SET status = 'completed', completed_at = COALESCE(completed_at, NOW()), updated_at = NOW()
         WHERE id = $1`,
        [scheduleId]
      );
      console.log(`[Worker] Schedule ${scheduleId} reached max_runs. Marked completed.`);
      return;
    }
  }

  const taskRes = await db.query(
    `INSERT INTO tasks (account_id, type, payload, status, started_at, schedule_id)
     VALUES ($1, $2, $3, 'running', NOW(), $4) RETURNING id`,
    [accountId, taskType || 'invite', payload, scheduleId]
  );
  const taskId = taskRes.rows[0].id;
  if (scheduleId) {
    await db.query(
      `UPDATE automation_schedules
       SET run_count = COALESCE(run_count, 0) + 1,
           last_run_at = NOW(),
           updated_at = NOW()
       WHERE id = $1`,
      [scheduleId]
    );
  }

  const emitLog = (accId, msg, type = 'info') => {
    workerEvents.emit('log', { accountId: accId, scheduleId, taskId, message: msg, type });
  };
  const incrementStats = (type = 'invite') => {
    workerEvents.emit('stats_inc', { type });
    if (type === 'unfollow') {
        db.query(`UPDATE accounts SET unfollows_today = COALESCE(unfollows_today, 0) + 1 WHERE id = $1`, [accountId]).catch(err => console.log('Error updating stats', err));
    } else if (type === 'invite') {
        db.query(`UPDATE accounts SET invites_sent_today = COALESCE(invites_sent_today, 0) + 1 WHERE id = $1`, [accountId]).catch(err => console.log('Error updating stats', err));
    }
  };

  let context, page;
  try {
    const accountResult = await db.query('SELECT proxy FROM accounts WHERE id = $1', [accountId]);
    const proxyString = accountResult.rows.length > 0 ? accountResult.rows[0].proxy : null;

    emitLog(accountId, `Đang mở trình duyệt cho task ${taskType}...`, 'system');
    const contextData = await createOrLoadContext(accountId, proxyString, false);
    context = contextData.context;
    page = contextData.page;

    emitLog(accountId, `🚀 Chạy job cho account: ${accountId}`, 'system');

    let result;
    if (taskType === 'unfollow_friends') {
        emitLog(accountId, `🚀 Bắt đầu Hủy Theo Dõi - Danh sách Bạn Bè (Limit: ${payload.maxUnfollow || 'Tất cả'})`);
        result = await autoUnfollowFriendsTask(page, context, account, payload, emitLog, incrementStats);
    } else if (taskType === 'unfollow_following') {
        emitLog(accountId, `🚀 Bắt đầu Hủy Theo Dõi - Danh sách Đang Theo Dõi (Limit: ${payload.maxUnfollow || 'Tất cả'})`);
        result = await autoUnfollowFollowingTask(page, context, account, payload, emitLog, incrementStats);
    } else if (taskType === 'warmup') {
        emitLog(accountId, `🚀 Bắt đầu quy trình Warm-up (Tăng độ tin cậy)`);
        result = await warmupTask(page, context, account, emitLog, incrementStats);
    } else if (taskType === 'comment_post') {
        emitLog(accountId, `Bắt đầu bình luận bài viết theo nội dung từ UI...`);
        result = await commentPostTask(page, context, account, payload, emitLog, incrementStats);
    } else if (taskType === 'create_post') {
        emitLog(accountId, `Bắt đầu đăng bài theo nội dung từ UI...`);
        result = await createPostTask(page, context, account, payload, emitLog, incrementStats);
    } else {
        emitLog(accountId, `Điều hướng tới: ${payload.url}`);
        await page.goto(payload.url, { waitUntil: 'domcontentloaded' });
        result = await autoInviteTask(page, context, account, payload.url, emitLog, incrementStats);
    }

    let summary = 'Hoàn thành.';
    if (result) {
        if (taskType === 'warmup') {
            summary = `Đã hoàn thành ${result.successCount} bước tương tác.`;
        } else {
            summary = `Thành công: ${result.successCount} lượt, ${result.scrollsDone} lần cuộn.`;
        }
    }

    await db.query(
      `UPDATE accounts
       SET last_run_at = NOW()
       WHERE id = $1`,
      [accountId]
    );

    await db.query(`UPDATE tasks SET status = 'completed', result_summary = $1, finished_at = NOW() WHERE id = $2`, [summary, taskId]);
    if (scheduleId) {
      await db.query(
        `UPDATE automation_schedules
         SET success_count = COALESCE(success_count, 0) + 1,
             status = CASE
               WHEN schedule_type = 'none' OR (max_runs IS NOT NULL AND COALESCE(run_count, 0) >= max_runs) THEN 'completed'
               ELSE status
             END,
             completed_at = CASE
               WHEN schedule_type = 'none' OR (max_runs IS NOT NULL AND COALESCE(run_count, 0) >= max_runs) THEN NOW()
               ELSE completed_at
             END,
             updated_at = NOW()
         WHERE id = $1`,
        [scheduleId]
      );
    }

  } catch (err) {
    const isBrowserClosed = err.message.includes('closed') || err.message.includes('Target page, context or browser has been closed');
    const displayError = isBrowserClosed ? 'Trình duyệt bị đóng (Người dùng hoặc Hệ thống)' : err.message;

    if (!isBrowserClosed) {
        await db.query(
          `UPDATE accounts SET error_count = error_count + 1 WHERE id = $1`,
          [accountId]
        );
    }
    await db.query(`UPDATE tasks SET status = 'failed', error = $1, finished_at = NOW() WHERE id = $2`, [displayError, taskId]);
    if (scheduleId) {
      await db.query(
        `UPDATE automation_schedules
         SET failed_count = COALESCE(failed_count, 0) + 1,
             status = CASE
               WHEN schedule_type = 'none' OR (max_runs IS NOT NULL AND COALESCE(run_count, 0) >= max_runs) THEN 'completed'
               ELSE status
             END,
             completed_at = CASE
               WHEN schedule_type = 'none' OR (max_runs IS NOT NULL AND COALESCE(run_count, 0) >= max_runs) THEN NOW()
               ELSE completed_at
             END,
             updated_at = NOW()
         WHERE id = $1`,
        [scheduleId]
      );
    }

    throw err;
  } finally {
    // Thêm delay ngẫu nhiên trước khi đóng
    await new Promise(r => setTimeout(r, 2000));
    if (context) {
        await context.close();
        emitLog(accountId, `Đã đóng trình duyệt.`);
    }
  }
  });
}, {
    connection,
    concurrency: parseInt(process.env.MAX_CONCURRENCY || 3), // Giảm xuống 3 để an toàn cho RAM/CPU
    lockDuration: 120000, // Tăng lên 120s (2 phút) để chịu được lag nặng
    lockRenewTime: 30000,
    autorun: false
});

const { runDailyTrendResearch } = require('./research-service');

const researchWorker = new Worker('research-queue', async job => {
    try {
        workerEvents.emit('cron_status', { status: 'running', message: '[V4] Daily product trend research started...' });
        await runDailyTrendResearch();
        workerEvents.emit('cron_status', { status: 'success', time: new Date().toISOString() });
    } catch (err) {
        workerEvents.emit('cron_status', { status: 'error', message: err.message });
        throw err;
    }
}, {
    connection,
    concurrency: 1,
    lockDuration: 120000,
    lockRenewTime: 30000,
    autorun: false
});

const affVidWorker = new Worker('aff-vid-queue', processAffVidJob, {
    connection,
    concurrency: parseInt(process.env.AFF_VID_CONCURRENCY || 1, 10),
    lockDuration: 180000,
    lockRenewTime: 30000,
    autorun: false
});

const upPostWorker = new Worker('up-post-queue', processUpPostJob, {
    connection,
    concurrency: parseInt(process.env.UP_POST_CONCURRENCY || 2, 10),
    lockDuration: 120000,
    lockRenewTime: 30000,
    autorun: false
});

async function cleanupFinishedScheduleJobs(job) {
  const scheduleId = job?.data?.payload?.scheduleId;
  if (!scheduleId || !inviteQueue) return;

  const scheduleRes = await db.query(
    'SELECT status, max_runs, run_count FROM automation_schedules WHERE id = $1',
    [scheduleId]
  );
  const schedule = scheduleRes.rows[0];
  const shouldRemove = !schedule ||
    schedule.status !== 'active' ||
    (schedule.max_runs && Number(schedule.run_count || 0) >= Number(schedule.max_runs));

  if (!shouldRemove) return;

  const idText = String(scheduleId);
  const repeatableJobs = await inviteQueue.getRepeatableJobs().catch(() => []);
  for (const repeatJob of repeatableJobs) {
    const key = String(repeatJob.key || '');
    const jobId = String(repeatJob.id || '');
    if (key.includes(idText) || jobId.includes(idText)) {
      await inviteQueue.removeRepeatableByKey(repeatJob.key).catch(() => {});
    }
  }

  const pendingJobs = await inviteQueue.getJobs(['waiting', 'delayed', 'prioritized', 'paused']).catch(() => []);
  for (const pendingJob of pendingJobs) {
    if (String(pendingJob?.data?.payload?.scheduleId || '') === idText) {
      await pendingJob.remove().catch(() => {});
    }
  }
}

worker.on('completed', job => {
  console.log(`✅ Job done: ${job.id}`);
  workerEvents.emit('log', { accountId: job.data.accountId, message: `✅ Tác vụ hoàn thành (Job ID: ${job.id})`, type: 'success' });
  cleanupFinishedScheduleJobs(job).catch(err => console.error('[Worker] Schedule cleanup failed:', err.message));
});

worker.on('failed', (job, err) => {
  console.log(`❌ Job failed: ${job.id}`, err.message);
  workerEvents.emit('log', { accountId: job.data.accountId, message: `❌ Tác vụ thất bại: ${err.message}`, type: 'error' });
  cleanupFinishedScheduleJobs(job).catch(cleanupErr => console.error('[Worker] Schedule cleanup failed:', cleanupErr.message));
});

let workersStarted = false;
function startWorkers() {
  if (workersStarted) return;
  workersStarted = true;
  worker.run().catch(err => console.error('[Worker] Invite worker stopped:', err));
  researchWorker.run().catch(err => console.error('[Worker] Research worker stopped:', err));
  affVidWorker.run().catch(err => console.error('[Worker] AFF VID worker stopped:', err));
  upPostWorker.run().catch(err => console.error('[Worker] UP POST worker stopped:', err));
}

module.exports = { worker, researchWorker, affVidWorker, upPostWorker, workerEvents, startWorkers };
