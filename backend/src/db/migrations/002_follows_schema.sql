-- ==============================================================================
-- FRENZO MIGRATION 002: SOCIAL CONNECTIONS (FOLLOWS SCHEMA)
-- ==============================================================================
-- Scope:
--   1. follows table for storing social graph edges
--
-- Relational & Security Invariants:
--   - Composite primary key (follower_id, following_id) prevents duplicate follows.
--   - Check constraint chk_follows_no_self_follow prevents self-following.
--   - Foreign keys to users(id) with ON DELETE CASCADE ensure referential integrity.
--   - Index on following_id enables reverse lookup (who is following user X).
--   - TIMESTAMPTZ UTC timestamp for edge creation auditing.
--   - Safe transaction ownership (runner wraps execution in advisory lock & transaction).
-- ==============================================================================

CREATE TABLE follows (
    follower_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    following_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CONSTRAINT chk_follows_no_self_follow CHECK (follower_id <> following_id)
);

-- Index for querying followers of a user (lookup by target/following_id)
CREATE INDEX idx_follows_following_id ON follows (following_id);
