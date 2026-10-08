-- Website and local search audits, and their delivery to the customer by email or text.

CREATE TABLE audits (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','done','failed')),
  score INTEGER,                    -- overall 0-100
  result TEXT,                      -- JSON: scores, findings, passed checks, coverage, Google profile, competitors
  hidden TEXT NOT NULL DEFAULT '[]',-- JSON array of finding ids staff removed from the customer's report
  note TEXT,                        -- personal note shown at the top of the customer's report
  shared_at INTEGER,                -- first sent to the customer; only shared checks appear in their portal
  error TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX audits_client ON audits(client_id, created_at);

CREATE TABLE audit_deliveries (
  id TEXT PRIMARY KEY,
  audit_id TEXT NOT NULL REFERENCES audits(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  recipient TEXT NOT NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL, -- the customer's portal login the message pointed to
  link_kind TEXT NOT NULL CHECK (link_kind IN ('invite','login')),
  status TEXT NOT NULL,             -- sent | failed | not_configured
  error TEXT,
  provider_id TEXT,
  sent_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX audit_deliveries_audit ON audit_deliveries(audit_id);
