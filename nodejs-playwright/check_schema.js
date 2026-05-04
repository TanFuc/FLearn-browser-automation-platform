const db = require('./src/db');
async function run() {
    const r1 = await db.query("SELECT column_name FROM information_schema.columns WHERE table_name='accounts' ORDER BY ordinal_position");
    console.log('accounts:', r1.rows.map(x => x.column_name).join(', '));
    const r2 = await db.query("SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name");
    console.log('tables:', r2.rows.map(x => x.table_name).join(', '));
    process.exit(0);
}
run().catch(e => { console.error(e.message); process.exit(1); });
