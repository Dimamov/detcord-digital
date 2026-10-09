-- Agreement builder: reusable templates (packages), where each draft came from, and client change requests.

-- Admin-managed starting points for agreements. Terms only: parties and attachments always come from the client.
CREATE TABLE contract_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  data TEXT NOT NULL,               -- JSON: services, depositCents, paymentTerms, thirdParty, additional, paymentDays, feedbackDays
  archived_at INTEGER,              -- archived templates are hidden from reps and can't start new agreements
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX contract_templates_active ON contract_templates(archived_at, name);

ALTER TABLE contracts ADD COLUMN template_id TEXT REFERENCES contract_templates(id) ON DELETE SET NULL;
ALTER TABLE contracts ADD COLUMN copied_from TEXT REFERENCES contracts(id) ON DELETE SET NULL;

-- A client asking for changes to an agreement sent to them. The frozen document never changes;
-- staff answer by voiding it and sending a redrafted copy.
CREATE TABLE contract_change_requests (
  id TEXT PRIMARY KEY,
  contract_id TEXT NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,         -- the agreement version the client was looking at
  note TEXT NOT NULL,
  author_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX contract_change_requests_contract ON contract_change_requests(contract_id, created_at);
