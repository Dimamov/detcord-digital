-- Proposals: staff check the services, Claude drafts why each one fits from what the client told us,
-- staff set the prices and edit and share. The portal computes the totals. Accepting one starts a draft
-- agreement with the same services and prices. Clients only ever see shared (or accepted) proposals.
CREATE TABLE proposals (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','shared','accepted')),
  services TEXT NOT NULL,           -- JSON: [{ serviceId, name, setupCents, monthlyCents, scope }] the checked services, in catalog order
  facts TEXT,                       -- JSON snapshot of what the draft was built from; null until generated
  draft TEXT,                       -- JSON exactly as Claude returned it; null when staff write it by hand
  draft_source TEXT CHECK (draft_source IN ('ai','staff')),
  content TEXT NOT NULL,            -- JSON: intro, services, next_steps, staff_notes (the version staff edit and share)
  edited INTEGER NOT NULL DEFAULT 0,
  error TEXT,                       -- why Claude could not draft it, for staff only
  version INTEGER NOT NULL DEFAULT 0, -- how many times it has been shared
  generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  generated_at INTEGER,
  edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  edited_at INTEGER,
  shared_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  shared_at INTEGER,
  unshared_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  unshared_at INTEGER,
  delivery TEXT,                    -- JSON: the share emails [{ name, email, status, error }]
  accepted_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  accepted_name TEXT,
  accepted_at INTEGER,
  contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL, -- the draft agreement started from it
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX proposals_client ON proposals(client_id, created_at);
CREATE INDEX proposals_status ON proposals(status, shared_at);

-- Every generated draft and every shared version, so what the client saw can always be looked up.
CREATE TABLE proposal_versions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('generated','shared')),
  version INTEGER NOT NULL,         -- the shared version number (0 for drafts generated before the first share)
  services TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX proposal_versions_proposal ON proposal_versions(proposal_id, created_at);

-- The client's questions and change requests on a shared proposal.
CREATE TABLE proposal_questions (
  id TEXT PRIMARY KEY,
  proposal_id TEXT NOT NULL REFERENCES proposals(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,         -- the shared version the client was reading
  note TEXT NOT NULL,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX proposal_questions_proposal ON proposal_questions(proposal_id, created_at);
