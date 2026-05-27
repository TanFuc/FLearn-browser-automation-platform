require('dotenv').config();
const { Queue } = require('bullmq');
const IORedis = require('ioredis');

const redisOptions = {
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: process.env.REDIS_PORT || 6379,
  maxRetriesPerRequest: null
};

if (process.env.REDIS_PASSWORD) {
  redisOptions.password = process.env.REDIS_PASSWORD;
}

const connection = new IORedis(redisOptions);
const inviteQueue = new Queue('invite-queue', { connection });

async function addInviteJob(accountId, payload, customOpts = {}) {
  const baseOpts = {
    attempts: 1, // Chỉ thử 1 lần, không tự động hiện lại khi bị lỗi/tắt
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: true,
    removeOnFail: false
  };
  
  await inviteQueue.add('invite', {
    accountId,
    payload
  }, { ...baseOpts, ...customOpts });
}

const researchQueue = new Queue('research-queue', { connection });
const RESEARCH_DAILY_PATTERN = '0 8 * * *';
const APP_TIMEZONE = process.env.APP_TIMEZONE || process.env.TZ || 'Asia/Ho_Chi_Minh';
const RESEARCH_DAILY_JOB_ID = 'daily-manual-research';

async function addResearchJob() {
  const repeatableJobs = await researchQueue.getRepeatableJobs().catch(() => []);
  for (const job of repeatableJobs) {
    const isExpectedJob = job.name === 'manual-research' &&
      job.pattern === RESEARCH_DAILY_PATTERN &&
      job.tz === APP_TIMEZONE;
    if (!isExpectedJob) {
      await researchQueue.removeRepeatableByKey(job.key).catch(() => {});
    }
  }

  await researchQueue.add('manual-research', { trigger: 'daily-cron' }, {
    jobId: RESEARCH_DAILY_JOB_ID,
    repeat: { pattern: RESEARCH_DAILY_PATTERN, tz: APP_TIMEZONE },
    attempts: 3,
    backoff: { type: 'exponential', delay: 5 * 60 * 1000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

module.exports = {
  inviteQueue,
  researchQueue,
  addInviteJob,
  addResearchJob,
  RESEARCH_DAILY_JOB_ID,
  RESEARCH_DAILY_PATTERN
};
