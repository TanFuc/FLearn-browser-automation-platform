/**
 * Research API Routes
 * Mounted at /api/research
 */
const express = require('express');
const router = express.Router();
const db = require('./db');
const { callGemini, getQuota, setBlocked } = require('./gemini');
const {
    researchMMO, researchAITools, researchSuggestions, runDailyResearch,
    getMMOFromDB, getAIToolsFromDB, getSuggestionsFromDB,
} = require('./research-service');

// ─── Page 1 — MMO / Affiliate ──────────────────────────────────────────────
router.get('/page-1', async (req, res) => {
    try {
        let data = await getMMOFromDB();
        const meta = { source: 'db', count: data.length };

        // If DB is empty → trigger fresh research
        if (data.length === 0) {
            data = await researchMMO();
            meta.source = 'ai';
        }
        res.json({ success: true, data, meta });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Page 2 — AI Tools ─────────────────────────────────────────────────────
router.get('/page-2', async (req, res) => {
    try {
        let data = await getAIToolsFromDB();
        const meta = { source: 'db', count: data.length };

        if (data.length === 0) {
            data = await researchAITools();
            meta.source = 'ai';
        }
        res.json({ success: true, data, meta });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Page 3 — AI Suggestions ───────────────────────────────────────────────
router.get('/page-3', async (req, res) => {
    try {
        let data = await getSuggestionsFromDB();
        const meta = { source: 'db', count: data.length };

        if (data.length === 0) {
            data = await researchSuggestions();
            meta.source = 'ai';
        }
        res.json({ success: true, data, meta });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Manual refresh with cooldown ──────────────────────────────────────────
const refreshCooldowns = {}; // page → last refresh timestamp

router.post('/refresh', async (req, res) => {
    const { page } = req.body; // 'mmo' | 'ai_tools' | 'suggestions'
    if (!['mmo', 'ai_tools', 'suggestions'].includes(page)) {
        return res.status(400).json({ error: 'Invalid page. Use: mmo, ai_tools, suggestions' });
    }

    const now = Date.now();
    const cooldown = 5 * 60 * 1000; // 5 minutes
    if (refreshCooldowns[page] && now - refreshCooldowns[page] < cooldown) {
        const remaining = Math.ceil((cooldown - (now - refreshCooldowns[page])) / 1000);
        return res.status(429).json({ error: `Cooldown active. Wait ${remaining}s before refreshing again.` });
    }

    try {
        // Clear cache so next call forces AI
        await db.query(`DELETE FROM cached_research WHERE page_type = $1`, [page]);

        let data;
        if (page === 'mmo') {
            await db.query(`DELETE FROM research_results WHERE page_type = 'mmo'`);
            data = await researchMMO();
        } else if (page === 'ai_tools') {
            await db.query(`DELETE FROM research_results WHERE page_type = 'ai_tools'`);
            data = await researchAITools();
        } else {
            data = await researchSuggestions();
        }

        refreshCooldowns[page] = now;
        res.json({ success: true, count: Array.isArray(data) ? data.length : 0 });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Quota / Usage ─────────────────────────────────────────────────────────
router.get('/usage', async (req, res) => {
    try {
        const quota = await getQuota();
        const recentLogs = await db.query(
            `SELECT * FROM api_usage_logs ORDER BY created_at DESC LIMIT 20`
        );
        res.json({ quota, recent_calls: recentLogs.rows });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Admin endpoints ───────────────────────────────────────────────────────
router.post('/admin/run-daily-job', async (req, res) => {
    res.json({ success: true, message: 'Daily research job started in background.' });
    runDailyResearch().catch(console.error);
});

router.post('/admin/reset-quota', async (req, res) => {
    try {
        await db.query(`
            UPDATE quota_state SET
                request_count = 0, prompt_tokens = 0, output_tokens = 0,
                total_tokens = 0, cache_hits = 0, is_blocked = FALSE,
                date = CURRENT_DATE, updated_at = NOW()
            WHERE id = 1
        `);
        await setBlocked(false);
        res.json({ success: true, message: 'Quota reset.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// ─── Topics management ─────────────────────────────────────────────────────
router.get('/topics', async (req, res) => {
    const r = await db.query(`SELECT * FROM research_topics ORDER BY id`);
    res.json(r.rows);
});

router.post('/topics', async (req, res) => {
    const { name, category } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await db.query(
        `INSERT INTO research_topics (name, category) VALUES ($1, $2) RETURNING *`,
        [name, category || 'general']
    );
    res.json(r.rows[0]);
});

router.delete('/topics/:id', async (req, res) => {
    await db.query(`DELETE FROM research_topics WHERE id = $1`, [req.params.id]);
    res.json({ success: true });
});

module.exports = router;
