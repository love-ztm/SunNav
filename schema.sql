-- SunNav D1 schema v3
-- 关系化设计：解决整段 JSON 覆盖与 100KB 上限。
-- 旧 schema 仅 config(key,value)。bootstrap 启动时检测 schema_version 自动迁移。
-- v3: categories.is_private（登录可见的私密分类）；存量库由 ensureSchema 自动补列。

CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS categories (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  is_private INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS subcategories (
  id TEXT PRIMARY KEY,
  category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  position INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE IF NOT EXISTS links (
  id TEXT PRIMARY KEY,
  subcategory_id TEXT NOT NULL REFERENCES subcategories(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  url TEXT NOT NULL,
  description TEXT,
  icon TEXT,
  position INTEGER NOT NULL DEFAULT 0,
  visit_count INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_sub_cat ON subcategories(category_id, position);
CREATE INDEX IF NOT EXISTS idx_link_sub ON links(subcategory_id, position);

CREATE TABLE IF NOT EXISTS rate_limits (
  identifier TEXT NOT NULL,
  scope TEXT NOT NULL,
  window_end INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (identifier, scope)
);
CREATE INDEX IF NOT EXISTS idx_rl_window ON rate_limits(window_end);

INSERT OR IGNORE INTO config (key, value) VALUES ('auth_code', 'admin');
INSERT OR IGNORE INTO config (key, value) VALUES ('schema_version', '2');
