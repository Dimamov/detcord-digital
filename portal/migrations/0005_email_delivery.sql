CREATE TABLE outbound_emails (
 id TEXT PRIMARY KEY, provider_id TEXT UNIQUE, recipient TEXT NOT NULL,
 subject TEXT NOT NULL, status TEXT NOT NULL, error TEXT,
 is_alert INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX outbound_emails_time ON outbound_emails(created_at);
CREATE TABLE email_events (
 id TEXT PRIMARY KEY, email_id TEXT NOT NULL, type TEXT NOT NULL,
 created_at INTEGER NOT NULL, alert_sent INTEGER NOT NULL DEFAULT 0
);
