jest.mock('bullmq', () => {
    return {
        Queue: jest.fn().mockImplementation(() => ({
            add: jest.fn().mockResolvedValue(true),
            getRepeatableJobs: jest.fn().mockResolvedValue([]),
            removeRepeatableByKey: jest.fn().mockResolvedValue(true)
        }))
    };
});
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        connect: jest.fn(),
    }));
});

const { addInviteJob, inviteQueue, addResearchJob, researchQueue } = require('../src/queue');

describe('Queue Module', () => {
    it('should add a job to the queue with correct parameters', async () => {
        const payload = { url: 'http://test.com' };
        await addInviteJob('test_acc', payload);
        
        expect(inviteQueue.add).toHaveBeenCalledWith('invite', {
            accountId: 'test_acc',
            payload
        }, expect.objectContaining({
            attempts: 3,
            removeOnComplete: true
        }));
    });

    it('should add the daily research repeatable job as manual-research', async () => {
        await addResearchJob();

        expect(researchQueue.add).toHaveBeenCalledWith('manual-research', {}, expect.objectContaining({
            jobId: 'daily-manual-research',
            repeat: { pattern: '0 8 * * *', tz: 'Asia/Ho_Chi_Minh' },
            attempts: 3,
            removeOnComplete: true
        }));
    });
});
