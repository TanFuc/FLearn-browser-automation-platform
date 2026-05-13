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
    attempts: 3,
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

async function addResearchJob() {
  const repeatableJobs = await researchQueue.getRepeatableJobs().catch(() => []);
  for (const job of repeatableJobs) {
    const isDailyResearchJob = job.pattern === RESEARCH_DAILY_PATTERN;
    const isStaleJob = job.name !== 'manual-research' || job.tz !== APP_TIMEZONE;
    if (isDailyResearchJob && isStaleJob) {
      await researchQueue.removeRepeatableByKey(job.key).catch(() => {});
    }
  }

  await researchQueue.add('manual-research', {}, {
    jobId: 'daily-manual-research',
    repeat: { pattern: RESEARCH_DAILY_PATTERN, tz: APP_TIMEZONE },
    attempts: 3,
    backoff: { type: 'exponential', delay: 10000 },
    removeOnComplete: true,
    removeOnFail: false
  });
}

module.exports = {
  inviteQueue,
  researchQueue,
  addInviteJob,
  addResearchJob
};
