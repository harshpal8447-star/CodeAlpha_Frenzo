-- ==============================================================================
-- FRENZO MIGRATION 004: POST LIKES & COMMENTS SCHEMA
-- ==============================================================================
-- Scope:
--   1. Add likes_count and comments_count interaction counters to posts table
--   2. post_likes table with composite primary key (post_id, user_id)
--   3. post_comments table with UUID primary key, content constraint, and soft deletion
--   4. Partial indexes for post timeline discussions and user activity auditing
--
-- Relational & Security Invariants:
--   - Nonnegative integer check constraints on posts counters (likes_count >= 0, comments_count >= 0).
--   - Native PostgreSQL UUID primary keys (gen_random_uuid()).
--   - Foreign keys to users(id) and posts(id) with ON DELETE CASCADE.
--   - Trimmed nonempty comment content constraint up to 500 characters.
--   - Safe transaction ownership (runner wraps execution in advisory lock & transaction).
--   - Lock timeout protects connection pool from queue starvation during ALTER TABLE.
-- ==============================================================================

-- 1. Protect connection pool from lock starvation during ALTER TABLE
SET lock_timeout = '5s';

-- 2. Add nonnegative interaction counters to posts table
ALTER TABLE posts 
ADD COLUMN likes_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT chk_posts_likes_count_nonnegative CHECK (likes_count >= 0),
ADD COLUMN comments_count INTEGER NOT NULL DEFAULT 0 CONSTRAINT chk_posts_comments_count_nonnegative CHECK (comments_count >= 0);

RESET lock_timeout;

-- 3. Post Likes Table (Social Graph Edges)
CREATE TABLE post_likes (
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (post_id, user_id)
);

-- Reverse lookup index for querying posts liked by a specific user
CREATE INDEX idx_post_likes_user_id ON post_likes (user_id);

-- 4. Post Comments Table
CREATE TABLE post_comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    post_id UUID NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT chk_comments_content_length CHECK (
        char_length(trim(content)) > 0 AND char_length(content) <= 500
    )
);

-- Partial deterministic chronological index for comment threads on active posts
CREATE INDEX idx_comments_post_timeline 
ON post_comments (post_id, created_at ASC, id ASC) 
WHERE deleted_at IS NULL;

-- User lookup index for comment activity auditing
CREATE INDEX idx_comments_user_id 
ON post_comments (user_id) 
WHERE deleted_at IS NULL;
