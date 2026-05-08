const db = require('./src/db');
const { Queue } = require('bullmq');
const Redis = require('ioredis');
require('dotenv').config();

async function clear() {
    console.log('🧹 Đang dọn dẹp các tác vụ cũ trong hàng đợi...');

    // 1. Cập nhật trạng thái trong Database
    try {
        const res = await db.query(
            "UPDATE tasks SET status = 'failed', error = 'Cancelled by cleanup script' WHERE status IN ('pending', 'active')"
        );
        console.log(`✅ Đã hủy ${res.rowCount} tác vụ trong Database.`);
    } catch (err) {
        console.error('❌ Lỗi Database:', err.message);
    }

    // 2. Xóa sạch hàng đợi trong Redis
    const connection = new Redis({
        host: process.env.REDIS_HOST || '127.0.0.1',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD || undefined,
        maxRetriesPerRequest: null
    });

    const queueNames = ['invite-queue', 'unfollow-queue', 'login-queue'];
    for (const name of queueNames) {
        try {
            const q = new Queue(name, { connection });
            await q.obliterate({ force: true });
            console.log(`✅ Đã xóa sạch hàng đợi: ${name}`);
        } catch (e) {
            console.log(`⚠️ Hàng đợi ${name} không tồn tại hoặc đã sạch.`);
        }
    }

    console.log('\n✨ Xong! Bây giờ bạn có thể chạy "npm start" mà không lo Chrome tự bật.');
    process.exit(0);
}

clear();
