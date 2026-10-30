-- ==============================================================================
-- FRENZO MIGRATION 001: INITIAL CORE SCHEMA
-- ==============================================================================
-- Scope: Exactly 4 approved Phase 2 tables:
--   1. users
--   2. profiles
--   3. refresh_tokens
--   4. password_reset_tokens
--
-- Relational & Security Invariants:
--   - Native PostgreSQL 16 UUID primary keys (gen_random_uuid()).
--   - TIMESTAMPTZ UTC timestamps throughout.
--   - Functional unique indexes for case-insensitive email & handle uniqueness.
--   - Non-redundant indexes (primary keys and unique constraints already index columns).
--   - Safe transaction ownership (this file does NOT contain BEGIN/COMMIT; runner owns transactions).
-- ==============================================================================

-- ------------------------------------------------------------------------------
-- 1. USERS TABLE (Private Authentication & Lifecycle)
-- ------------------------------------------------------------------------------
CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    email_verified BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_users_email_syntax CHECK (
        email ~* '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$'
    )
);

-- Case-insensitive email uniqueness functional index
CREATE UNIQUE INDEX idx_users_email_lower ON users (LOWER(email));

-- ------------------------------------------------------------------------------
-- 2. PROFILES TABLE (Public Social Identity & Metrics)
-- ------------------------------------------------------------------------------
CREATE TABLE profiles (
    id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    username VARCHAR(30) NOT NULL,
    display_name VARCHAR(60) NOT NULL,
    bio TEXT,
    avatar_url TEXT DEFAULT NULL,
    banner_url TEXT DEFAULT NULL,
    website VARCHAR(255) DEFAULT NULL,
    is_private BOOLEAN NOT NULL DEFAULT FALSE,
    followers_count INTEGER NOT NULL DEFAULT 0 CHECK (followers_count >= 0),
    following_count INTEGER NOT NULL DEFAULT 0 CHECK (following_count >= 0),
    posts_count INTEGER NOT NULL DEFAULT 0 CHECK (posts_count >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_profiles_username_syntax CHECK (
        username ~ '^[a-zA-Z0-9_]{3,30}$'
    ),
    CONSTRAINT chk_profiles_bio_length CHECK (
        bio IS NULL OR char_length(bio) <= 300
    ),
    CONSTRAINT chk_profiles_website_syntax CHECK (
        website IS NULL OR website ~* '^https?://[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}(/.*)?$'
    )
);

-- Case-insensitive handle uniqueness functional index
CREATE UNIQUE INDEX idx_profiles_username_lower ON profiles (LOWER(username));

-- ------------------------------------------------------------------------------
-- 3. REFRESH_TOKENS TABLE (Session Management & Token Family Rotation)
-- ------------------------------------------------------------------------------
CREATE TABLE refresh_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    family_id UUID NOT NULL,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    user_agent TEXT DEFAULT NULL,
    ip_address VARCHAR(45) DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at TIMESTAMPTZ DEFAULT NULL,
    CONSTRAINT uq_refresh_tokens_hash UNIQUE (token_hash)
);

-- Non-redundant indexes supporting user queries, family revocation, and cleanup pruning
CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens (user_id);
CREATE INDEX idx_refresh_tokens_family_revocation ON refresh_tokens (family_id) WHERE is_revoked = FALSE;
CREATE INDEX idx_refresh_tokens_cleanup ON refresh_tokens (expires_at);

-- ------------------------------------------------------------------------------
-- 4. PASSWORD_RESET_TOKENS TABLE (Single-Use Recovery Credentials)
-- ------------------------------------------------------------------------------
CREATE TABLE password_reset_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ DEFAULT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_pwd_reset_tokens_hash UNIQUE (token_hash)
);

-- Index on user_id to support user-based reset invalidation and cascade lookups
-- (token_hash lookup is already indexed via uq_pwd_reset_tokens_hash)
CREATE INDEX idx_pwd_reset_tokens_user_id ON password_reset_tokens (user_id);
