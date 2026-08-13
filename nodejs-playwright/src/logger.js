const db = require('./db');

let socketIO = null;

function setLogEmitter(io) {
    socketIO = io;
}

function serializeMeta(meta = {}) {
    const entries = Object.entries(meta)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => {
            const rendered = typeof value === 'object' ? JSON.stringify(value) : String(value);
            return `${key}=${rendered}`;
        });
    return entries.length ? ` | ${entries.join(' ')}` : '';
}

function maskSensitiveLogValue(value = '') {
    return String(value)
        .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[email]')
        .replace(/(password|pass|token|cookie|authorization|secret)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s|]+)/gi, '$1=[hidden]')
        .replace(/(fb_password|fb_email)\s*[:=]\s*("[^"]+"|'[^']+'|[^\s|]+)/gi, '$1=[hidden]');
}

async function emitSystemLog(message, type = 'info', meta = {}) {
    const fullMessage = maskSensitiveLogValue(`${message}${serializeMeta(meta)}`);
    const data = { accountId: meta.accountId || 'system', type, message: fullMessage };
    const prefix = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'log';
    console[prefix](`[${data.accountId}] ${fullMessage}`);
    if (socketIO) socketIO.emit('log', data);
    try {
        await db.query(
            'INSERT INTO logs (account_id, schedule_id, task_id, type, message) VALUES ($1, $2, $3, $4, $5)',
            [data.accountId, meta.scheduleId || null, meta.taskId || null, data.type, data.message]
        );
    } catch (err) {
        console.error('[Logger] Failed to persist log:', err.message);
    }
}

module.exports = {
    emitSystemLog,
    setLogEmitter
};
