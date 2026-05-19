const USER_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_login DATETIME,
    is_active BOOLEAN DEFAULT 1,
    git_name TEXT,
    git_email TEXT,
    has_completed_onboarding BOOLEAN DEFAULT 0
);
`;

export const API_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS api_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    key_name TEXT NOT NULL,
    api_key TEXT UNIQUE NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_used DATETIME,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_CREDENTIALS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_credentials (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    credential_name TEXT NOT NULL,
    credential_type TEXT NOT NULL, -- 'github_token', 'gitlab_token', 'bitbucket_token', etc.
    credential_value TEXT NOT NULL,
    description TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    is_active BOOLEAN DEFAULT 1,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS user_notification_preferences (
    user_id INTEGER PRIMARY KEY,
    preferences_json TEXT NOT NULL,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const VAPID_KEYS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS vapid_keys (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    public_key TEXT NOT NULL,
    private_key TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

export const PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    endpoint TEXT NOT NULL UNIQUE,
    keys_p256dh TEXT NOT NULL,
    keys_auth TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`;

export const PROJECTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
    project_id TEXT PRIMARY KEY NOT NULL,
    project_path TEXT NOT NULL UNIQUE,
    custom_project_name TEXT DEFAULT NULL,
    isStarred BOOLEAN DEFAULT 0,
    isArchived BOOLEAN DEFAULT 0
);
`;

export const SESSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT NOT NULL,
    provider TEXT NOT NULL DEFAULT 'claude',
    custom_name TEXT,
    project_path TEXT,
    jsonl_path TEXT,
    isArchived BOOLEAN DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id),
    FOREIGN KEY (project_path) REFERENCES projects(project_path)
    ON DELETE SET NULL
    ON UPDATE CASCADE
);
`;

export const LAST_SCANNED_AT_SQL = `
CREATE TABLE IF NOT EXISTS scan_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  last_scanned_at TIMESTAMP NULL
);
`;

export const APP_CONFIG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS app_config (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
`;

// ---------------------------------------------------------------------------
// Analytics module schema (additive — never modifies upstream tables)
// ---------------------------------------------------------------------------

export const ANALYTICS_PROJECTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_projects (
    id          TEXT PRIMARY KEY NOT NULL,
    name        TEXT NOT NULL,
    path        TEXT NOT NULL UNIQUE,
    first_seen  INTEGER NOT NULL,
    last_seen   INTEGER NOT NULL
);
`;

export const ANALYTICS_SESSIONS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_sessions (
    id                    TEXT PRIMARY KEY NOT NULL,
    project_id            TEXT REFERENCES analytics_projects(id) ON DELETE CASCADE,
    started_at            INTEGER NOT NULL,
    ended_at              INTEGER,
    model                 TEXT,
    tokens_input          INTEGER NOT NULL DEFAULT 0,
    tokens_output         INTEGER NOT NULL DEFAULT 0,
    tokens_cache_read     INTEGER NOT NULL DEFAULT 0,
    tokens_cache_create   INTEGER NOT NULL DEFAULT 0,
    estimated_cost_usd    REAL NOT NULL DEFAULT 0,
    message_count         INTEGER NOT NULL DEFAULT 0,
    tool_call_count       INTEGER NOT NULL DEFAULT 0,
    subagent_count        INTEGER NOT NULL DEFAULT 0,
    jsonl_path            TEXT NOT NULL,
    jsonl_mtime           INTEGER NOT NULL,
    jsonl_size            INTEGER NOT NULL
);
`;

export const ANALYTICS_EVENTS_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_events (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id            TEXT NOT NULL REFERENCES analytics_sessions(id) ON DELETE CASCADE,
    ts                    INTEGER NOT NULL,
    type                  TEXT NOT NULL,
    tool_name             TEXT,
    agent_name            TEXT,
    model                 TEXT,
    tokens_input          INTEGER,
    tokens_output         INTEGER,
    tokens_cache_read     INTEGER,
    tokens_cache_create   INTEGER,
    duration_ms           INTEGER,
    is_error              INTEGER NOT NULL DEFAULT 0,
    raw_offset            INTEGER NOT NULL
);
`;

export const ANALYTICS_INGEST_LOG_TABLE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS analytics_ingest_log (
    jsonl_path     TEXT PRIMARY KEY NOT NULL,
    last_offset    INTEGER NOT NULL DEFAULT 0,
    last_mtime     INTEGER NOT NULL,
    last_ingest    INTEGER NOT NULL,
    error_count    INTEGER NOT NULL DEFAULT 0
);
`;

export const ANALYTICS_INDEXES_SQL = `
CREATE INDEX IF NOT EXISTS idx_analytics_events_session ON analytics_events(session_id);
CREATE INDEX IF NOT EXISTS idx_analytics_events_ts ON analytics_events(ts);
CREATE INDEX IF NOT EXISTS idx_analytics_events_tool ON analytics_events(tool_name);
CREATE INDEX IF NOT EXISTS idx_analytics_events_agent ON analytics_events(agent_name);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_project ON analytics_sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_analytics_sessions_started ON analytics_sessions(started_at);
CREATE INDEX IF NOT EXISTS idx_analytics_events_ts_type ON analytics_events(ts, type);
`;

export const INIT_SCHEMA_SQL = `
-- Initialize authentication database
PRAGMA foreign_keys = ON;

${USER_TABLE_SCHEMA_SQL}
-- Indexes for performance for user lookups
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active);

${API_KEYS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_api_keys_key ON api_keys(api_key);
CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id);
CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);

${USER_CREDENTIALS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_credentials_user_id ON user_credentials(user_id);
CREATE INDEX IF NOT EXISTS idx_user_credentials_type ON user_credentials(credential_type);
CREATE INDEX IF NOT EXISTS idx_user_credentials_active ON user_credentials(is_active);

${USER_NOTIFICATION_PREFERENCES_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_user_notification_preferences_user_id ON user_notification_preferences(user_id);

${VAPID_KEYS_TABLE_SCHEMA_SQL}

${PUSH_SUBSCRIPTIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_push_subscriptions_user_id ON push_subscriptions(user_id);

${PROJECTS_TABLE_SCHEMA_SQL}
-- NOTE: These indexes are created in migrations after legacy table-shape repairs.
-- Creating them here can fail on upgraded installs where projects lacks those columns.

${SESSIONS_TABLE_SCHEMA_SQL}
CREATE INDEX IF NOT EXISTS idx_session_ids_lookup ON sessions(session_id);
-- NOTE: This index is created in migrations after sessions is rebuilt to include project_path.
-- Creating it here can fail on upgraded installs where the legacy sessions table has no project_path.

${LAST_SCANNED_AT_SQL}

${APP_CONFIG_TABLE_SCHEMA_SQL}
`;
