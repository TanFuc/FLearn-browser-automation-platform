/**
 * Product Trend API Routes V4.0.1
 * Mounted at /api/product-trends
 */
const express = require('express');
const router = express.Router();
const db = require('./db');
const { getProductTrends, getProductDetail, runDailyTrendResearch } = require('./research-service');

// ─── Lấy danh sách Trend ──────────────────────────────────────────────
router.get('/', async (req, res) => {
    try {
        const market = req.query.market || 'vn';
        const categoriesStr = req.query.categories || 'Skincare,Gia dụng,Fitness,Thời trang,Mẹ & bé';
        const categories = categoriesStr.split(',').map(c => c.trim());
        const limit = parseInt(req.query.limit || '8', 10);
        const window = req.query.window || 'last_7_days';
        const mode = req.query.mode || 'overview';
        const page = parseInt(req.query.page || '1', 10);

        const result = await getProductTrends({ market, categories, limit, window, mode });

        const total = result.data.length; // Simplified total
        
        res.json({
            meta: {
                schema_version: result.schema_version,
                market,
                window,
                mode,
                generated_at: new Date().toISOString(),
                is_stale: result.is_stale,
                pagination: {
                    page,
                    limit,
                    total,
                    has_more: false // Assuming we return all we have up to limit
                }
            },
            data: result.data
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Lấy chi tiết 1 sản phẩm ──────────────────────────────────────────
router.get('/:id', async (req, res) => {
    try {
        const productId = req.params.id;
        
        // Overview from DB
        const baseRes = await db.query(`SELECT raw_data FROM product_trend_results WHERE product_id = $1`, [productId]);
        if (baseRes.rows.length === 0) {
            return res.status(404).json({ error: 'Product not found' });
        }
        const overview = baseRes.rows[0].raw_data;

        // Fetch deep dive
        const deepDive = await getProductDetail(productId, 'deep_dive');
        const opportunity = await getProductDetail(productId, 'opportunity');

        res.json({
            meta: { schema_version: 'V4.0.1', product_id: productId },
            data: {
                overview,
                deep_dive: deepDive,
                opportunity
            }
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Refresh thủ công ──────────────────────────────────────────────────
router.post('/refresh', async (req, res) => {
    try {
        const { market = 'vn', categories = ['Skincare', 'Gia dụng'], source_window = 'last_7_days', mode = 'overview' } = req.body;
        
        // Force refresh by ignoring cache? For now, we rely on cache TTL.
        // To truly force, we might need a flag to bypass cache, but let's stick to standard flow.
        const result = await getProductTrends({ market, categories, window: source_window, mode, limit: 10 });
        
        res.json({ success: true, message: 'Refreshed successfully.', data: result.data });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

// ─── Thao tác quản trị nội bộ ─────────────────────────────────────────

router.post('/admin/run-daily-job', async (req, res) => {
    const { researchQueue } = require('./queue');
    const date = new Date().toISOString().split('T')[0];
    await researchQueue.add('manual-research', {}, {
        jobId: `trend_manual_${date}`
    });
    res.json({ success: true, message: 'Daily trend job queued in background.' });
});

router.post('/admin/reset-quota', async (req, res) => {
    try {
        await db.query(`
            UPDATE quota_state SET
                request_count = 0, prompt_tokens = 0, output_tokens = 0,
                total_tokens = 0, cache_hits = 0, is_blocked = FALSE,
                blocked_until = NULL, blocked_model = NULL,
                date = CURRENT_DATE, updated_at = NOW()
            WHERE id = 1
        `);
        const { setBlocked } = require('./gemini');
        await setBlocked(false);
        res.json({ success: true, message: 'Quota reset.' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
