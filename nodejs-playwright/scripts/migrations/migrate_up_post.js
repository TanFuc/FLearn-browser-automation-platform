const db = require('../../src/db');

async function run() {
    console.log('Running UP POST migration...');
    try {
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
                schema_version TEXT DEFAULT 'UP_POST_V2',
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
                    CHECK (status IN ('draft', 'validated', 'queued', 'posting', 'published', 'failed'));
                END IF;
            END $$;
        `);
        await db.query(`
            DO $$ BEGIN
                IF EXISTS (
                    SELECT 1 FROM pg_constraint
                    WHERE conname = 'up_post_variants_status_check'
                      AND pg_get_constraintdef(oid) NOT LIKE '%posting%'
                ) THEN
                    ALTER TABLE up_post_variants DROP CONSTRAINT up_post_variants_status_check;
                    ALTER TABLE up_post_variants
                    ADD CONSTRAINT up_post_variants_status_check
                    CHECK (status IN ('draft', 'validated', 'queued', 'posting', 'published', 'failed'));
                END IF;
            END $$;
        `);
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_up_post_variants_source
            ON up_post_variants(source_content_id, platform)
        `);
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_up_post_variants_status
            ON up_post_variants(status, scheduled_time)
        `);
        await db.query(`
            CREATE INDEX IF NOT EXISTS idx_up_post_variants_campaign
            ON up_post_variants(campaign_tag, platform)
        `);
        await db.query(`
            UPDATE up_post_variants
            SET
                post_type = COALESCE(post_type, post_data->>'post_type'),
                title = COALESCE(title, post_data->>'title'),
                hook = COALESCE(hook, post_data->>'hook'),
                body = COALESCE(body, post_data->>'body'),
                cta = COALESCE(cta, COALESCE(post_data->>'CTA', post_data->>'cta')),
                raw_json = COALESCE(raw_json, '{}'::jsonb),
                validation_warnings = COALESCE(validation_warnings, post_data->'validation_warnings', '[]'::jsonb),
                render_data = COALESCE(render_data, jsonb_build_object(
                    'platform', platform,
                    'title', COALESCE(post_data->>'title', ''),
                    'hook', COALESCE(post_data->>'hook', ''),
                    'body', COALESCE(post_data->>'body', ''),
                    'CTA', COALESCE(post_data->>'CTA', post_data->>'cta', ''),
                    'hashtags', COALESCE(post_data->'hashtags', '[]'::jsonb),
                    'preview_text', CONCAT(COALESCE(post_data->>'body', ''), E'\\n\\n', COALESCE((
                        SELECT string_agg(value, ' ')
                        FROM jsonb_array_elements_text(COALESCE(post_data->'hashtags', '[]'::jsonb)) AS value
                    ), '')),
                    'warnings', COALESCE(post_data->'validation_warnings', '[]'::jsonb)
                ))
            WHERE post_data IS NOT NULL
        `);
        console.log('UP POST migration complete.');
    } catch (err) {
        console.error('UP POST migration failed:', err.message);
        process.exitCode = 1;
    } finally {
        await db.end();
    }
}

run();
