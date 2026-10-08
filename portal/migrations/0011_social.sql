-- Social posting through Zernio. Staff write a post, the client approves exactly what will go out,
-- and only then is it sent to Zernio. Approval binds to a hash of the content, media, accounts and time.

-- The client's Zernio profile (one per client; its connected social accounts live in Zernio).
ALTER TABLE clients ADD COLUMN zernio_profile_id TEXT;

-- Last known connected accounts, refreshed from Zernio whenever the Social tab or page loads.
-- Used to check that a post only names this client's accounts; publishing checks Zernio again.
CREATE TABLE social_accounts (
  id TEXT PRIMARY KEY,               -- Zernio account _id
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  platform TEXT NOT NULL,
  username TEXT,
  display_name TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL
);
CREATE INDEX social_accounts_client ON social_accounts(client_id);

CREATE TABLE social_posts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  goat_request_id TEXT REFERENCES goat_requests(id) ON DELETE SET NULL,
  content TEXT NOT NULL DEFAULT '',
  media_ids TEXT NOT NULL DEFAULT '[]',   -- JSON: media ids, in order
  accounts TEXT NOT NULL DEFAULT '[]',    -- JSON: [{ id, platform, username }] as shown to the client
  scheduled_for INTEGER,                  -- null = publish when staff press Publish
  draft_source TEXT,                      -- 'claude' when the text started as a Claude draft
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending_approval','changes_requested','approved','publishing','scheduled','published','partial','failed','cancelled')),
  content_hash TEXT NOT NULL,             -- hash of what the post says now
  sent_at INTEGER,                        -- first sent to the client; clients never see unsent drafts
  approved_hash TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_via TEXT,                      -- 'portal' (the client) or 'admin' (recorded on their behalf)
  approval_note TEXT,                     -- required when an admin records approval
  approved_at INTEGER,
  zernio_post_id TEXT,
  zernio_status TEXT,                     -- as Zernio reports it
  zernio_platforms TEXT,                  -- JSON: [{ platform, status, platformPostUrl, errorMessage }]
  zernio_error TEXT,
  published_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  published_at INTEGER,                   -- when the post was handed to Zernio
  checked_at INTEGER,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX social_posts_client ON social_posts(client_id, updated_at);
CREATE INDEX social_posts_goat ON social_posts(goat_request_id);

-- History shown on the post: created, sent, approved, changes asked, published, status from Zernio.
CREATE TABLE social_events (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES social_posts(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT,
  kind TEXT NOT NULL,
  body TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX social_events_post ON social_events(post_id, created_at);
