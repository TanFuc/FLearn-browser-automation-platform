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

async function emitSystemLog(message, type = 'info', meta = {}) {
    const fullMessage = `${message}${serializeMeta(meta)}`;
    const data = { accountId: meta.accountId || 'system', type, message: fullMessage };
    const prefix = type === 'error' ? 'error' : type === 'warning' ? 'warn' : 'log';
    console[prefix](`[${data.accountId}] ${fullMessage}`);
    if (socketIO) socketIO.emit('log', data);
    try {
        await db.query(
            'INSERT INTO logs (account_id, type, message) VALUES ($1, $2, $3)',
            [data.accountId, data.type, data.message]
        );
    } catch (err) {
        console.error('[Logger] Failed to persist log:', err.message);
    }
}

module.exports = {
    emitSystemLog,
    setLogEmitter
};
