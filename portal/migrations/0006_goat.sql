-- GOAT Command: client requests from the portal, email and text, one workflow for all three.

-- A request. client_id is null only while an inbound email or text waits for staff to match its sender
-- to a client; those are never visible to client logins.
CREATE TABLE goat_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('portal','email','sms')),
  sender_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT,
  sender_address TEXT,              -- email address or E.164 phone number, as received
  subject TEXT,
  body TEXT NOT NULL,               -- the original message, unchanged
  category TEXT NOT NULL DEFAULT 'other',
  status TEXT NOT NULL CHECK (status IN ('unmatched','new','proposed','approved','in_progress','done','failed','cancelled')),
  proposal TEXT,                    -- JSON: summary, steps, content, execution ('team' | 'automatic'), questions
  proposal_source TEXT,             -- 'ai' or 'staff'
  proposal_hash TEXT,               -- hash of the proposal as shown; approval binds to it
  proposed_at INTEGER,
  approved_hash TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  approved_via TEXT,                -- 'portal' or 'sms'
  approved_at INTEGER,
  assignee_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  result_note TEXT,                 -- completion evidence shown to the client
  result_url TEXT,
  failure TEXT,                     -- why it could not be done, shown to the client
  external_key TEXT UNIQUE,         -- duplicate guard: email Message-ID, Twilio MessageSid, or the portal's submit key
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER
);
CREATE INDEX goat_requests_client ON goat_requests(client_id, created_at);
CREATE INDEX goat_requests_status ON goat_requests(status, updated_at);

-- Timeline: comments, status changes and replies. internal=1 rows are staff-only.
CREATE TABLE goat_events (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL REFERENCES goat_requests(id) ON DELETE CASCADE,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  actor_label TEXT,
  kind TEXT NOT NULL,
  body TEXT,
  internal INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX goat_events_request ON goat_events(request_id, created_at);

CREATE TABLE goat_attachments (
  request_id TEXT NOT NULL REFERENCES goat_requests(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'request' CHECK (role IN ('request','result')),
  PRIMARY KEY (request_id, media_id)
);

-- Unknown senders who texted or emailed. A claimed business name never grants access;
-- staff match the sender to a client, which also adds them as a contact.
CREATE TABLE goat_senders (
  id TEXT PRIMARY KEY,
  channel TEXT NOT NULL CHECK (channel IN ('email','sms')),
  address TEXT NOT NULL,
  claimed_name TEXT,
  claimed_business TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified','rejected')),
  client_id TEXT REFERENCES clients(id) ON DELETE SET NULL,
  asked_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (channel, address)
);
