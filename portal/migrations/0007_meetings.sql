-- Recorded in-person sales meetings: audio in R2, transcript from Deepgram, notes drafted by Claude.
-- Staff only. Recording requires the rep to confirm the client agreed, and that confirmation is kept.
CREATE TABLE meetings (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  rep_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  consent_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  consent_at INTEGER NOT NULL,
  r2_key TEXT,                      -- null once the audio is deleted
  content_type TEXT,
  size INTEGER,
  duration_sec REAL,
  status TEXT NOT NULL CHECK (status IN ('uploaded','transcribing','transcribed','analyzing','ready','failed')),
  provider_request_id TEXT,
  callback_hash TEXT,               -- hash of the one-time token in Deepgram's callback URL
  transcript TEXT,                  -- JSON: [{ speaker, start, end, text }]
  analysis TEXT,                    -- JSON from Claude; the rep reviews it before anything is saved
  error TEXT,
  discovery_id TEXT REFERENCES discoveries(id) ON DELETE SET NULL,
  saved_at INTEGER,
  saved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX meetings_client ON meetings(client_id, created_at);
