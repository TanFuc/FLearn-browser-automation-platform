const db = require('./db');
const { callGemini, getQuota } = require('./gemini');

const UP_POST_SCHEMA_VERSION = 'UP_POST_V2';
const UP_POST_STATUSES = ['draft', 'validated', 'queued', 'published', 'failed'];

const PLATFORM_CONFIG = {
    threads: {
        label: 'Threads',
        postType: 'text',
        maxBodyLength: 500,
        maxHashtags: 4,
        minHashtags: 1,
        promptRule: 'short, curious, conversational, opinion-led, 1-3 compact paragraphs, minimal hashtags',
        fallbackTone: 'curious opinion'
    },
    facebook: {
        label: 'Facebook text post',
        postType: 'text',
        maxBodyLength: 2200,
        maxHashtags: 8,
        minHashtags: 3,
        promptRule: 'clear feed post with context, readable paragraphs, useful explanation, and CTA',
        fallbackTone: 'clear context'
    },
    facebook_text: {
        aliasOf: 'facebook'
    },
    tiktok_caption: {
        label: 'TikTok caption',
        postType: 'caption',
        maxBodyLength: 300,
        maxHashtags: 6,
        minHashtags: 3,
        promptRule: 'strong hook, fast rhythm, compact action-focused caption, short hashtags',
        fallbackTone: 'fast hook'
    },
    facebook_video: {
        label: 'Facebook video post',
        postType: 'video_post',
        maxBodyLength: 1600,
        maxHashtags: 8,
        minHashtags: 3,
        promptRule: 'video-aware post that explains what viewers will see, includes hook, CTA, and optional shot cues',
        fallbackTone: 'video description'
    }
};

const DEFAULT_PLATFORMS = ['threads', 'facebook', 'tiktok_caption', 'facebook_video'];

const PROMPT_FALLBACK = `You are UP POST Planner for Vietnamese social publishing.
Return valid JSON only. No markdown. No explanation.

TASK:
Convert the supplied normalized source into distinct platform-specific post variants.
Do not use one generic post for all platforms. Do not invent price, discount, proof, personal experience, guarantee, availability, or external links.

REQUIRED FLOW:
1. Use only NORMALIZED SOURCE JSON.
2. Create exactly one post for each requested platform.
3. Follow the platform_rules for each platform.
4. Add warnings if the source is weak, claims are uncertain, or evidence is missing.

OUTPUT JSON SHAPE:
{
  "source_content_id":"{{SOURCE_CONTENT_ID}}",
  "source_type":"{{SOURCE_TYPE}}",
  "warnings":["string"],
  "posts":[
    {
      "platform":"threads|facebook|tiktok_caption|facebook_video",
      "post_type":"text|caption|video_post",
      "title":"string",
      "hook":"string",
      "body":"string",
      "CTA":"string",
      "hashtags":["#tag"],
      "confidence_score":0,
      "platform_fit_score":0,
      "validation_warnings":["string"],
      "shot_suggestions":["string"]
    }
  ]
}

QUALITY RULES:
- Threads: short, curious/opinion-led, compact, minimal hashtags.
- Facebook text: clearer context, readable feed structure, useful reason, CTA.
- TikTok caption: strong first phrase, fast rhythm, concise hashtags.
- Facebook video: describe the video, name what viewers will see, include CTA and shot suggestions if useful.
- Every body must be materially different.
- Hashtags must start with # and contain no spaces.
- If source lacks evidence, avoid strong claims and add a warning.

NORMALIZED SOURCE JSON:
{{SOURCE_JSON}}

REQUESTED PLATFORMS:
{{PLATFORMS_JSON}}

PLATFORM RULES:
{{PLATFORM_RULES_JSON}}

POST OPTIONS:
{{POST_OPTIONS_JSON}}`;

function renderPrompt(template, variables = {}) {
    return Object.entries(variables).reduce((output, [key, value]) => {
        const pattern = new RegExp(`\\{\\{\\s*${key}\\s*\\}}`, 'g');
        return output.replace(pattern, String(value ?? ''));
    }, template || '');
}

async function getPromptTextOrFallback(variables = {}) {
    try {
        const r = await db.query(
            `SELECT prompt_text FROM research_prompts
             WHERE page_type = 'up_post' AND is_active = TRUE
             ORDER BY updated_at DESC LIMIT 1`
        );
        if (r.rows[0]?.prompt_text) return renderPrompt(r.rows[0].prompt_text, variables);
    } catch (err) {}
    return renderPrompt(PROMPT_FALLBACK, variables);
}

function score(value, fallback = 0) {
    const n = Number(value);
    if (!Number.isFinite(n)) return fallback;
    return Math.max(0, Math.min(100, Math.round(n)));
}

function slug(value, fallback = 'item') {
    return String(value || fallback)
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 96) || fallback;
}

function safeText(value, fallback = '') {
    if (value === undefined || value === null) return fallback;
    return String(value).trim() || fallback;
}

function asArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return [];
    return [value];
}

function cleanPlatform(platform) {
    const key = String(platform || '').trim().toLowerCase();
    const config = PLATFORM_CONFIG[key];
    if (!config) return null;
    return config.aliasOf || key;
}

function cleanPlatforms(platforms = DEFAULT_PLATFORMS) {
    const result = [];
    asArray(platforms).forEach(platform => {
        const clean = cleanPlatform(platform);
        if (clean && !result.includes(clean)) result.push(clean);
    });
    return result;
}

function platformConfig(platform) {
    return PLATFORM_CONFIG[cleanPlatform(platform)] || PLATFORM_CONFIG.facebook;
}

function sanitizeHashtag(tag) {
    const cleaned = String(tag || '')
        .trim()
        .replace(/^#+/, '')
        .replace(/\s+/g, '')
        .replace(/[^\p{L}\p{N}_]/gu, '');
    return cleaned ? `#${cleaned}` : null;
}

function normalizeHashtags(tags, platform, sourceTags = []) {
    const config = platformConfig(platform);
    const merged = [...asArray(tags), ...asArray(sourceTags), '#AI', '#review'];
    const seen = new Set();
    const out = [];
    for (const tag of merged) {
        const clean = sanitizeHashtag(tag);
        if (!clean || seen.has(clean.toLowerCase())) continue;
        seen.add(clean.toLowerCase());
        out.push(clean);
        if (out.length >= config.maxHashtags) break;
    }
    while (out.length < config.minHashtags) {
        const fallback = ['#congcuAI', '#xuhuong', '#muasamthongminh'][out.length] || '#goiy';
        if (!seen.has(fallback.toLowerCase())) out.push(fallback);
        else break;
    }
    return out;
}

function extractObject(data) {
    if (Array.isArray(data)) return data[0] || {};
    if (!data || typeof data !== 'object') return {};
    if (typeof data.raw === 'string') {
        try {
            return extractObject(JSON.parse(data.raw));
        } catch (err) {
            return {};
        }
    }
    if (data.data && typeof data.data === 'object') return extractObject(data.data);
    return data;
}

function extractPosts(data) {
    if (Array.isArray(data)) return data;
    const obj = extractObject(data);
    if (Array.isArray(obj.posts)) return obj.posts;
    if (Array.isArray(obj.items)) return obj.items;
    if (Array.isArray(obj.variants)) return obj.variants;
    return [];
}

async function ensureUpPostTables() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS up_post_variants (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            post_id TEXT UNIQUE NOT NULL,
            source_content_id TEXT NOT NULL,
            source_type TEXT NOT NULL,
            platform TEXT NOT NULL,
            post_data JSONB NOT NULL,
            status TEXT DEFAULT 'draft',
            queue_payload JSONB,
            scheduled_time TIMESTAMP,
            schema_version TEXT DEFAULT '${UP_POST_SCHEMA_VERSION}',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS raw_json JSONB`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS render_data JSONB`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS validation_warnings JSONB DEFAULT '[]'::jsonb`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS campaign_tag TEXT`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS post_type TEXT`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS title TEXT`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS hook TEXT`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS body TEXT`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS cta TEXT`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS hashtags TEXT[] DEFAULT ARRAY[]::TEXT[]`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS confidence_score INTEGER DEFAULT 0`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS platform_fit_score INTEGER DEFAULT 0`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS model_name TEXT`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS generated_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ`);
    await db.query(`ALTER TABLE up_post_variants ADD COLUMN IF NOT EXISTS failed_reason TEXT`);
    await db.query(`
        DO $$ BEGIN
            IF NOT EXISTS (
                SELECT 1 FROM pg_constraint
                WHERE conname = 'up_post_variants_status_check'
            ) THEN
                ALTER TABLE up_post_variants
                ADD CONSTRAINT up_post_variants_status_check
                CHECK (status IN ('draft', 'validated', 'queued', 'published', 'failed'));
            END IF;
        END $$;
    `);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_up_post_variants_source ON up_post_variants(source_content_id, platform)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_up_post_variants_status ON up_post_variants(status, scheduled_time)`);
    await db.query(`CREATE INDEX IF NOT EXISTS idx_up_post_variants_campaign ON up_post_variants(campaign_tag, platform)`);
    await db.query(`
        UPDATE up_post_variants
        SET
            post_type = COALESCE(post_type, post_data->>'post_type'),
            title = COALESCE(title, post_data->>'title'),
            hook = COALESCE(hook, post_data->>'hook'),
            body = COALESCE(body, post_data->>'body'),
            cta = COALESCE(cta, COALESCE(post_data->>'CTA', post_data->>'cta')),
            confidence_score = COALESCE(confidence_score, NULLIF(post_data->>'confidence_score', '')::INTEGER, 0),
            platform_fit_score = COALESCE(platform_fit_score, NULLIF(post_data->>'platform_fit_score', '')::INTEGER, 0),
            raw_json = COALESCE(raw_json, '{}'::jsonb),
            validation_warnings = COALESCE(validation_warnings, post_data->'validation_warnings', '[]'::jsonb),
            render_data = COALESCE(render_data, jsonb_build_object(
                'platform', platform,
                'title', COALESCE(post_data->>'title', ''),
                'hook', COALESCE(post_data->>'hook', ''),
                'body', COALESCE(post_data->>'body', ''),
                'CTA', COALESCE(post_data->>'CTA', post_data->>'cta', ''),
                'hashtags', COALESCE(post_data->'hashtags', '[]'::jsonb),
                'preview_text', CONCAT(COALESCE(post_data->>'body', ''), E'\n\n', COALESCE((
                    SELECT string_agg(value, ' ')
                    FROM jsonb_array_elements_text(COALESCE(post_data->'hashtags', '[]'::jsonb)) AS value
                ), '')),
                'warnings', COALESCE(post_data->'validation_warnings', '[]'::jsonb)
            ))
        WHERE post_data IS NOT NULL
    `);
}

async function ensureAffVideoTable() {
    await db.query(`
        CREATE TABLE IF NOT EXISTS aff_video_plans (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            product_id TEXT NOT NULL REFERENCES product_trend_results(product_id) ON DELETE CASCADE,
            plan_data JSONB NOT NULL,
            status TEXT DEFAULT 'draft',
            platform_targets TEXT[] DEFAULT ARRAY[]::TEXT[],
            source_window TEXT,
            schema_version TEXT DEFAULT 'AFF_VID_V1',
            created_at TIMESTAMP DEFAULT NOW(),
            updated_at TIMESTAMP DEFAULT NOW()
        )
    `);
}

function normalizeSourceContent(source) {
    const c = source.content || {};
    const warnings = [];
    const title = safeText(c.product_name || c.title || c.tool_name || c.niche || c.product_id || source.source_content_id);
    const hook = safeText(c.hook || c.angle || c.summary || c.caption || c.search_intent || title);
    const summary = safeText(c.summary || c.caption || c.angle || c.use_case || c.market_reason || hook);
    const cta = safeText(c.CTA || c.cta || c.next_action);
    const hashtags = normalizeHashtags(c.hashtags || c.tags || [], 'facebook');
    if (!title) warnings.push('Source lacks title/product name.');
    if (!hook) warnings.push('Source lacks hook/angle.');
    if (!cta) warnings.push('Source lacks CTA.');
    if (!summary) warnings.push('Source lacks summary/context.');
    return {
        source_content_id: source.source_content_id,
        source_type: source.source_type,
        product_id: c.product_id || source.product_id || null,
        title,
        hook,
        summary,
        CTA: cta || 'Xem them thong tin va tu danh gia truoc khi quyet dinh.',
        hashtags,
        category: c.category || c.niche || c.tool_type || null,
        source_window: c.source_window || source.source_window || null,
        confidence_score: score(c.confidence_score || c.source_research?.confidence_score, 70),
        raw_source: c,
        source_warnings: warnings
    };
}

async function loadUpPostSources({ limit = 20, sourceType = 'aff_vid', date = null } = {}) {
    await ensureUpPostTables();
    await ensureAffVideoTable();
    const dateParams = [];
    const dateWhere = [];
    if (date) {
        dateParams.push(date);
        dateWhere.push(`DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = $${dateParams.length}`);
    }
    if (sourceType === 'research') {
        const params = [...dateParams, limit];
        const result = await db.query(`
            SELECT product_id as id, 'research' as source_type, raw_data as content, category, source_window, created_at
            FROM product_trend_results
            ${dateWhere.length ? `WHERE ${dateWhere.join(' AND ')}` : ''}
            ORDER BY created_at DESC
            LIMIT $${params.length}
        `, params);
        return result.rows.map(row => {
            const normalized = normalizeSourceContent({
                source_content_id: row.id,
                source_type: 'research',
                source_window: row.source_window,
                content: { ...(row.content || {}), product_id: row.id, category: row.content?.category || row.category, source_window: row.source_window }
            });
            return {
                source_content_id: row.id,
                source_type: row.source_type,
                title: normalized.title,
                summary: normalized.summary,
                platforms: DEFAULT_PLATFORMS,
                warnings: normalized.source_warnings,
                created_at: row.created_at
            };
        });
    }
    const params = [...dateParams, limit];
    const result = await db.query(`
        SELECT id, product_id, plan_data, platform_targets, status, source_window, created_at
        FROM aff_video_plans
        ${dateWhere.length ? `WHERE ${dateWhere.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT $${params.length}
    `, params);
    return result.rows.map(row => {
        const normalized = normalizeSourceContent({
            source_content_id: String(row.id),
            source_type: 'aff_vid',
            product_id: row.product_id,
            source_window: row.source_window,
            content: { ...(row.plan_data || {}), product_id: row.product_id, source_window: row.source_window }
        });
        return {
            source_content_id: String(row.id),
            source_type: 'aff_vid',
            product_id: row.product_id,
            title: normalized.title,
            summary: normalized.summary,
            platforms: DEFAULT_PLATFORMS,
            status: row.status,
            warnings: normalized.source_warnings,
            created_at: row.created_at
        };
    });
}

async function getUpPostAvailableDates(sourceType = 'aff_vid') {
    await ensureUpPostTables();
    const table = sourceType === 'research' ? 'product_trend_results' : 'aff_video_plans';
    const result = await db.query(`
        SELECT TO_CHAR(DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh'), 'YYYY-MM-DD') as day, COUNT(*)::INT as count
        FROM ${table}
        GROUP BY day
        ORDER BY day DESC
    `);
    return result.rows;
}

async function getUpPostSource(sourceContentId, sourceType = 'aff_vid') {
    await ensureUpPostTables();
    await ensureAffVideoTable();
    if (sourceType === 'research') {
        const result = await db.query(`
            SELECT product_id, raw_data, category, source_window, created_at
            FROM product_trend_results
            WHERE product_id = $1
        `, [sourceContentId]);
        if (!result.rows.length) return null;
        const row = result.rows[0];
        return {
            source_content_id: row.product_id,
            source_type: 'research',
            source_window: row.source_window,
            content: {
                ...(row.raw_data || {}),
                product_id: row.product_id,
                category: row.raw_data?.category || row.category,
                source_window: row.source_window
            }
        };
    }
    const result = await db.query(`
        SELECT id, product_id, plan_data, platform_targets, source_window, created_at
        FROM aff_video_plans
        WHERE id::TEXT = $1
    `, [sourceContentId]);
    if (!result.rows.length) return null;
    const row = result.rows[0];
    return {
        source_content_id: String(row.id),
        source_type: 'aff_vid',
        product_id: row.product_id,
        source_window: row.source_window,
        content: {
            ...(row.plan_data || {}),
            aff_video_plan_id: String(row.id),
            product_id: row.product_id,
            source_window: row.source_window
        }
    };
}

function fallbackBody(platform, source, options = {}) {
    const title = source.title || 'noi dung nay';
    const hook = source.hook || title;
    const cta = source.CTA || 'Xem them truoc khi quyet dinh.';
    if (platform === 'threads') {
        return `${hook}\n\n${title} dang co mot goc kha dang ban: no giai quyet dung mot nhu cau cu the, nhung van nen xem ky truoc khi chon. Ban muon minh tach checklist nen/khong nen khong?`;
    }
    if (platform === 'facebook') {
        return `${hook}\n\nNeu ban dang can them ngu canh ve ${title}, diem dang xem la van de no giai quyet, doi tuong phu hop, va nhung dieu can kiem tra truoc khi xuong tien.\n\n${source.summary || ''}\n\n${cta}`.trim();
    }
    if (platform === 'tiktok_caption') {
        return `${hook} Xem nhanh truoc khi mua. ${cta}`;
    }
    if (platform === 'facebook_video') {
        return `${hook}\n\nTrong video nay: mo dau bang van de, cho xem cach ${title} duoc dung, roi chot lai diem nen can nhac truoc khi quyet dinh.\n\n${cta}`;
    }
    return `${hook}\n\n${source.summary}\n\n${cta}`.trim();
}

function fallbackPost(platform, source, options = {}) {
    const config = platformConfig(platform);
    return {
        platform,
        post_type: options.post_type || config.postType,
        title: source.title,
        hook: source.hook,
        body: fallbackBody(platform, source, options),
        CTA: source.CTA,
        hashtags: normalizeHashtags(source.hashtags, platform),
        confidence_score: Math.min(source.confidence_score || 70, source.source_warnings.length ? 65 : 75),
        platform_fit_score: source.source_warnings.length ? 62 : 74,
        validation_warnings: [...source.source_warnings, 'Backend generated conservative fallback from source data.'],
        shot_suggestions: platform === 'facebook_video'
            ? ['Mo dau bang van de', 'Can canh source/product/workflow', 'Demo ket qua hoac cach dung', 'Ket voi CTA an toan']
            : []
    };
}

function detectClaimWarnings(text) {
    const warnings = [];
    const raw = String(text || '').toLowerCase();
    const risky = [
        /100\s*%/,
        /chac chan/,
        /cam ket/,
        /bao dam/,
        /tot nhat/,
        /re nhat/,
        /tri khoi/,
        /giam can/,
        /het mun/,
        /kiem tien nhanh/,
        /thu nhap thu dong/
    ];
    if (risky.some(pattern => pattern.test(raw))) {
        warnings.push('Contains strong or unsupported claim language; review before publishing.');
    }
    return warnings;
}

function renderData(post) {
    return {
        platform: post.platform,
        label: platformConfig(post.platform).label,
        title: post.title,
        hook: post.hook,
        body: post.body,
        CTA: post.CTA,
        hashtags: post.hashtags,
        preview_text: `${post.body}\n\n${post.hashtags.join(' ')}`.trim(),
        shot_suggestions: post.shot_suggestions || [],
        warnings: post.validation_warnings || []
    };
}

function queuePayload(post, source, options = {}) {
    return {
        post_id: post.post_id,
        source_content_id: post.source_content_id,
        source_type: source.source_type,
        platform: post.platform,
        post_type: post.post_type,
        title: post.title,
        hook: post.hook,
        body: post.body,
        CTA: post.CTA,
        hashtags: post.hashtags,
        scheduled_time: post.scheduled_time,
        campaign_tag: post.campaign_tag,
        schema_version: post.schema_version,
        render_data: post.render_data,
        publisher_handoff: {
            target: 'future_publisher_or_n8n',
            status: 'ready',
            created_at: post.generated_at
        }
    };
}

function validatePost(post, platform, source) {
    const config = platformConfig(platform);
    const warnings = [];
    const errors = [];
    if (!post.title) warnings.push('Missing title; source title was used.');
    if (!post.hook) warnings.push('Missing hook; source hook was used.');
    if (!post.body) errors.push('Missing body.');
    if (!post.CTA) warnings.push('Missing CTA; safe default was used.');
    if (post.body && post.body.length > config.maxBodyLength) warnings.push(`Body exceeds recommended ${config.label} length (${config.maxBodyLength}).`);
    if (!post.hashtags.length) warnings.push('Missing hashtags; fallback hashtags were used.');
    warnings.push(...detectClaimWarnings(`${post.title}\n${post.hook}\n${post.body}\n${post.CTA}`));
    if (source.source_warnings.length) warnings.push(...source.source_warnings);
    return {
        isValid: errors.length === 0,
        errors,
        warnings: [...new Set(warnings)]
    };
}

function normalizePostVariant(rawPost, source, platform, index, scheduledTime, options, modelName, rawJson) {
    const config = platformConfig(platform);
    const fallback = fallbackPost(platform, source, options);
    const raw = rawPost && typeof rawPost === 'object' ? rawPost : {};
    const body = safeText(raw.body, fallback.body);
    const hook = safeText(raw.hook, fallback.hook);
    const cta = safeText(raw.CTA || raw.cta, fallback.CTA);
    const postType = raw.post_type || options.post_type || config.postType;
    const generatedAt = new Date().toISOString();
    const base = {
        post_id: slug(raw.post_id || `${source.source_content_id}_${platform}`, `up_post_${index + 1}`),
        id: slug(raw.post_id || `${source.source_content_id}_${platform}`, `up_post_${index + 1}`),
        source_content_id: source.source_content_id,
        source_type: source.source_type,
        platform,
        post_type: postType,
        title: safeText(raw.title, fallback.title),
        hook,
        body,
        CTA: cta,
        hashtags: normalizeHashtags(raw.hashtags, platform, fallback.hashtags),
        confidence_score: score(raw.confidence_score, fallback.confidence_score),
        platform_fit_score: score(raw.platform_fit_score, fallback.platform_fit_score),
        scheduled_time: raw.scheduled_time || scheduledTime || null,
        campaign_tag: options.campaign_tag || null,
        schema_version: UP_POST_SCHEMA_VERSION,
        model_name: modelName,
        generated_at: generatedAt,
        raw_json: rawJson,
        shot_suggestions: asArray(raw.shot_suggestions || raw.scene_suggestions || fallback.shot_suggestions).map(String)
    };
    const validation = validatePost(base, platform, source);
    base.validation_errors = validation.errors;
    base.validation_warnings = [...new Set([...asArray(raw.validation_warnings), ...validation.warnings])];
    base.status = validation.isValid ? 'validated' : 'draft';
    base.render_data = renderData(base);
    base.queue_payload = queuePayload(base, source, options);
    return base;
}

function enforceDistinctPlatformPosts(posts, source) {
    const seen = new Map();
    return posts.map(post => {
        const key = String(post.body || '').trim().toLowerCase();
        if (!key || !seen.has(key)) {
            if (key) seen.set(key, post.platform);
            return post;
        }
        const body = fallbackBody(post.platform, source);
        const updated = {
            ...post,
            body,
            validation_warnings: [
                ...(post.validation_warnings || []),
                `Body duplicated with ${seen.get(key)}; backend applied ${post.platform} framing.`
            ]
        };
        updated.render_data = renderData(updated);
        updated.queue_payload = queuePayload(updated, source);
        return updated;
    });
}

function normalizeGeneratedResponse(aiData, source, platforms, scheduledTime, options, modelName, rawJson) {
    const posts = extractPosts(aiData);
    const byPlatform = new Map();
    posts.forEach(post => {
        const platform = cleanPlatform(post.platform);
        if (platform && !byPlatform.has(platform)) byPlatform.set(platform, post);
    });
    let normalizedPosts = platforms.map((platform, index) =>
        normalizePostVariant(byPlatform.get(platform), source, platform, index, scheduledTime, options, modelName, rawJson)
    );
    normalizedPosts = enforceDistinctPlatformPosts(normalizedPosts, source);
    const obj = extractObject(aiData);
    const warnings = [...asArray(obj.warnings), ...source.source_warnings];
    normalizedPosts.forEach(post => warnings.push(...(post.validation_warnings || [])));
    return {
        source_content_id: source.source_content_id,
        source_type: source.source_type,
        schema_version: UP_POST_SCHEMA_VERSION,
        generated_at: new Date().toISOString(),
        model_name: modelName,
        warnings: [...new Set(warnings)],
        posts: normalizedPosts
    };
}

function platformRules(platforms) {
    return platforms.reduce((acc, platform) => {
        const config = platformConfig(platform);
        acc[platform] = {
            label: config.label,
            post_type: config.postType,
            rule: config.promptRule,
            max_body_length: config.maxBodyLength,
            max_hashtags: config.maxHashtags
        };
        return acc;
    }, {});
}

async function chooseModelName(useLiteOverride) {
    if (useLiteOverride === true) return 'gemini-2.5-flash-lite';
    if (useLiteOverride === false) return 'gemini-2.5-flash';
    const quota = await getQuota();
    if (quota && quota.hard_cap && quota.request_count / quota.hard_cap >= 0.7) return 'gemini-2.5-flash-lite';
    return 'gemini-2.5-flash';
}

async function persistVariant(post) {
    await db.query(`
        INSERT INTO up_post_variants (
            post_id, source_content_id, source_type, platform,
            post_data, raw_json, render_data, status, queue_payload,
            scheduled_time, schema_version, validation_warnings,
            campaign_tag, post_type, title, hook, body, cta, hashtags,
            confidence_score, platform_fit_score, model_name, generated_at, updated_at
        )
        VALUES (
            $1, $2, $3, $4,
            $5, $6, $7, $8, $9,
            $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19,
            $20, $21, $22, $23, NOW()
        )
        ON CONFLICT (post_id) DO UPDATE SET
            post_data = EXCLUDED.post_data,
            raw_json = EXCLUDED.raw_json,
            render_data = EXCLUDED.render_data,
            status = EXCLUDED.status,
            queue_payload = EXCLUDED.queue_payload,
            scheduled_time = EXCLUDED.scheduled_time,
            schema_version = EXCLUDED.schema_version,
            validation_warnings = EXCLUDED.validation_warnings,
            campaign_tag = EXCLUDED.campaign_tag,
            post_type = EXCLUDED.post_type,
            title = EXCLUDED.title,
            hook = EXCLUDED.hook,
            body = EXCLUDED.body,
            cta = EXCLUDED.cta,
            hashtags = EXCLUDED.hashtags,
            confidence_score = EXCLUDED.confidence_score,
            platform_fit_score = EXCLUDED.platform_fit_score,
            model_name = EXCLUDED.model_name,
            generated_at = EXCLUDED.generated_at,
            updated_at = NOW()
    `, [
        post.post_id,
        post.source_content_id,
        post.source_type,
        post.platform,
        JSON.stringify(post),
        JSON.stringify(post.raw_json || {}),
        JSON.stringify(post.render_data || {}),
        post.status,
        JSON.stringify(post.queue_payload || {}),
        post.scheduled_time,
        post.schema_version,
        JSON.stringify(post.validation_warnings || []),
        post.campaign_tag,
        post.post_type,
        post.title,
        post.hook,
        post.body,
        post.CTA,
        post.hashtags,
        post.confidence_score,
        post.platform_fit_score,
        post.model_name,
        post.generated_at
    ]);
}

async function generateUpPosts({ sourceContentId, sourceType = 'aff_vid', platforms = DEFAULT_PLATFORMS, scheduledTime = null, options = {} }) {
    await ensureUpPostTables();
    const clean = cleanPlatforms(platforms);
    if (!clean.length) {
        const err = new Error('At least one valid platform is required.');
        err.status = 400;
        throw err;
    }
    const sourceRow = await getUpPostSource(sourceContentId, sourceType);
    if (!sourceRow) {
        const err = new Error('Source content not found.');
        err.status = 404;
        throw err;
    }
    const source = normalizeSourceContent(sourceRow);
    const modelName = await chooseModelName(options.useLite);
    const prompt = await getPromptTextOrFallback({
        SOURCE_CONTENT_ID: source.source_content_id,
        SOURCE_TYPE: source.source_type,
        SOURCE_JSON: JSON.stringify(source),
        PLATFORMS: JSON.stringify(clean),
        PLATFORMS_JSON: JSON.stringify(clean),
        PLATFORM_RULES: JSON.stringify(platformRules(clean)),
        PLATFORM_RULES_JSON: JSON.stringify(platformRules(clean)),
        POST_OPTIONS: JSON.stringify({
            scheduled_time: scheduledTime,
            campaign_tag: options.campaign_tag || null,
            post_type: options.post_type || null,
            tone: options.tone || 'clear, platform-native, safe CTA',
            cta_type: options.cta_type || 'engagement_or_click'
        }),
        POST_OPTIONS_JSON: JSON.stringify({
            scheduled_time: scheduledTime,
            campaign_tag: options.campaign_tag || null,
            post_type: options.post_type || null,
            tone: options.tone || 'clear, platform-native, safe CTA',
            cta_type: options.cta_type || 'engagement_or_click'
        })
    });
    let aiData = {};
    const warnings = [];
    try {
        aiData = await callGemini(prompt, {
            endpoint: 'up_post',
            skipCache: true,
            useLite: modelName.includes('lite')
        });
    } catch (err) {
        warnings.push(`Gemini error: ${err.message}`);
        aiData = { warnings, posts: [] };
    }
    const normalized = normalizeGeneratedResponse(aiData, source, clean, scheduledTime, options, modelName, aiData);
    normalized.warnings = [...new Set([...normalized.warnings, ...warnings])];
    for (const post of normalized.posts) {
        await persistVariant(post);
    }
    return normalized;
}

async function listUpPostVariants({ status, platform, sourceContentId, date, campaignTag, limit = 30 } = {}) {
    await ensureUpPostTables();
    const params = [];
    const where = [];
    if (status) {
        params.push(status);
        where.push(`status = $${params.length}`);
    }
    if (platform) {
        const clean = cleanPlatform(platform);
        if (clean) {
            params.push(clean);
            where.push(`platform = $${params.length}`);
        }
    }
    if (sourceContentId) {
        params.push(sourceContentId);
        where.push(`source_content_id = $${params.length}`);
    }
    if (campaignTag) {
        params.push(campaignTag);
        where.push(`campaign_tag = $${params.length}`);
    }
    if (date) {
        params.push(date);
        where.push(`DATE(created_at AT TIME ZONE 'Asia/Ho_Chi_Minh') = $${params.length}`);
    }
    params.push(parseInt(limit || 30, 10));
    const result = await db.query(`
        SELECT id, post_id, source_content_id, source_type, platform, post_type,
               title, hook, body, cta, hashtags, confidence_score, platform_fit_score,
               post_data, raw_json, render_data, validation_warnings, status, queue_payload,
               scheduled_time, campaign_tag, schema_version, model_name, generated_at,
               published_at, failed_reason, created_at, updated_at
        FROM up_post_variants
        ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC
        LIMIT $${params.length}
    `, params);
    return result.rows;
}

async function enqueueUpPostVariants(postIds = []) {
    await ensureUpPostTables();
    if (!Array.isArray(postIds) || !postIds.length) {
        const err = new Error('post_ids array is required.');
        err.status = 400;
        throw err;
    }
    const result = await db.query(`
        UPDATE up_post_variants
        SET status = 'queued', updated_at = NOW()
        WHERE post_id = ANY($1)
          AND status IN ('draft', 'validated', 'failed')
        RETURNING post_id, platform, queue_payload, status, campaign_tag, scheduled_time
    `, [postIds]);
    return result.rows;
}

module.exports = {
    UP_POST_SCHEMA_VERSION,
    UP_POST_STATUSES,
    UP_POST_PLATFORMS: DEFAULT_PLATFORMS,
    ensureUpPostTables,
    loadUpPostSources,
    getUpPostAvailableDates,
    generateUpPosts,
    listUpPostVariants,
    enqueueUpPostVariants,
    normalizeSourceContent,
    cleanPlatforms
};
