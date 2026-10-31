-- ==============================================================================
-- FRENZO MIGRATION 003: POSTS MODULE
-- ==============================================================================
-- Scope:
--   1. posts table for publishing user content and micro-blogs
--
-- Relational & Security Invariants:
--   - Native PostgreSQL 16 UUID primary key (gen_random_uuid()).
--   - Foreign key to users(id) with ON DELETE CASCADE.
--   - Content constraint: non-empty trimmed text up to 2,000 characters.
--   - Media URLs: JSONB array, default '[]'::jsonb for future asset support.
--   - Check constraint ensuring media_urls is a JSON array.
--   - Timestamps: created_at, updated_at, and nullable deleted_at for soft deletion.
--   - Partial deterministic timeline index: (user_id, created_at DESC, id DESC) WHERE deleted_at IS NULL.
--   - Safe transaction ownership (runner wraps execution in advisory lock & transaction).
-- ==============================================================================

CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    media_urls JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT chk_posts_content_length CHECK (
        char_length(trim(content)) > 0 AND char_length(content) <= 2000
    ),
    CONSTRAINT chk_posts_media_urls_is_array CHECK (
        jsonb_typeof(media_urls) = 'array'
    )
);

-- Partial deterministic timeline index for profile retrieval
CREATE INDEX idx_posts_user_timeline 
ON posts (user_id, created_at DESC, id DESC) 
WHERE deleted_at IS NULL;
