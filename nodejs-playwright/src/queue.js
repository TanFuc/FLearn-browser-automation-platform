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

async function addInviteJob(accountId, payload) {
  await inviteQueue.add('invite', {
    accountId,
    payload
  }, {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 5000
    },
    removeOnComplete: true,
    removeOnFail: false
  });
}

module.exports = {
  inviteQueue,
  addInviteJob
};
