-- Detcord portal v2: core schema (accounts, clients, sales).
-- Money is stored in integer cents. Times are epoch milliseconds.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin','rep','client')),
  status TEXT NOT NULL DEFAULT 'invited' CHECK (status IN ('invited','active','disabled')),
  phone TEXT,
  pw_hash TEXT,
  pw_salt TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX sessions_user ON sessions(user_id);

-- One-time links: account invitations and password resets.
CREATE TABLE tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('invite','reset')),
  token_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at INTEGER,
  delivery TEXT NOT NULL DEFAULT 'pending',
  delivery_error TEXT
);
CREATE INDEX tokens_user ON tokens(user_id, kind);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

CREATE TABLE clients (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  industry TEXT,
  website TEXT,
  phone TEXT,
  email TEXT,
  address TEXT,
  city TEXT,
  state TEXT DEFAULT 'MI',
  zip TEXT,
  timezone TEXT NOT NULL DEFAULT 'America/Detroit',
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead','prospect','active','paused','former')),
  source TEXT,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Client portal logins that belong to a business.
CREATE TABLE client_members (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  PRIMARY KEY (client_id, user_id)
);
CREATE INDEX client_members_user ON client_members(user_id);

-- Reps assigned to a business. Reps see only these clients.
CREATE TABLE assignments (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (client_id, user_id)
);
CREATE INDEX assignments_user ON assignments(user_id);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  is_primary INTEGER NOT NULL DEFAULT 0,
  is_decision_maker INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX contacts_client ON contacts(client_id);

-- Editable service catalog. Prices are optional defaults.
CREATE TABLE services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT,
  setup_cents INTEGER,
  monthly_cents INTEGER,
  active INTEGER NOT NULL DEFAULT 1,
  position INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE client_services (
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  service_id TEXT NOT NULL REFERENCES services(id),
  status TEXT NOT NULL DEFAULT 'recommended' CHECK (status IN ('recommended','proposed','active','ended')),
  setup_cents INTEGER,
  monthly_cents INTEGER,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (client_id, service_id)
);

CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  visibility TEXT NOT NULL DEFAULT 'internal' CHECK (visibility IN ('internal','shared')),
  created_at INTEGER NOT NULL
);
CREATE INDEX notes_client ON notes(client_id, created_at);

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  due_at INTEGER,
  done_at INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX tasks_owner ON tasks(owner_id, done_at, due_at);
CREATE INDEX tasks_client ON tasks(client_id);

-- Pipeline stages are configurable. Seeded defaults are marked provisional.
CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  outcome TEXT NOT NULL DEFAULT 'open' CHECK (outcome IN ('open','won','lost')),
  provisional INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE deals (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  owner_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  stage_id TEXT NOT NULL REFERENCES pipeline_stages(id),
  title TEXT NOT NULL,
  setup_cents INTEGER,
  monthly_cents INTEGER,
  expected_close TEXT,
  lost_reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  closed_at INTEGER
);
CREATE INDEX deals_client ON deals(client_id);
CREATE INDEX deals_owner ON deals(owner_id);

-- Commission rules are configurable; none are approved until an admin marks them so.
CREATE TABLE commission_rules (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  basis TEXT NOT NULL CHECK (basis IN ('setup','monthly','both')),
  rate_bps INTEGER NOT NULL,
  months INTEGER,
  trigger TEXT NOT NULL CHECK (trigger IN ('deal_won','contract_signed','invoice_paid')),
  rep_id TEXT REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 1,
  approved INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Sales discovery interviews.
CREATE TABLE discoveries (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  rep_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  industry TEXT,
  modules TEXT NOT NULL DEFAULT '[]',
  answers TEXT NOT NULL DEFAULT '{}',
  result TEXT,
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','complete')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX discoveries_client ON discoveries(client_id);

-- Pre-call intake forms sent to prospects (public link, no login).
CREATE TABLE intake_links (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  submitted_at INTEGER,
  answers TEXT
);

CREATE TABLE activity (
  id TEXT PRIMARY KEY,
  client_id TEXT REFERENCES clients(id) ON DELETE CASCADE,
  actor_id TEXT,
  kind TEXT NOT NULL,
  summary TEXT NOT NULL,
  internal INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE INDEX activity_client ON activity(client_id, created_at);
CREATE INDEX activity_time ON activity(created_at);

INSERT INTO pipeline_stages (id, name, position, outcome, provisional) VALUES
  ('new', 'New lead', 1, 'open', 1),
  ('discovery', 'Discovery booked', 2, 'open', 1),
  ('proposal', 'Proposal sent', 3, 'open', 1),
  ('negotiation', 'Negotiation', 4, 'open', 1),
  ('won', 'Won', 5, 'won', 1),
  ('lost', 'Lost', 6, 'lost', 1);
