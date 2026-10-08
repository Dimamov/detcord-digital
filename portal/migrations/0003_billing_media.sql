-- Phase B: contracts with e-sign, invoices and payments, shared client files.

-- Simple key/value settings (company details for contracts, integration status).
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  updated_by TEXT
);

-- Human-friendly document numbers (DD-2026-0001).
CREATE TABLE counters (
  name TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);

CREATE TABLE contracts (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  deal_id TEXT REFERENCES deals(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','signed','void')),
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,                -- JSON: services, prices, scope, parties, terms
  presented_html TEXT,               -- frozen document shown for signature
  document_hash TEXT,                -- SHA-256 of presented_html
  signed_html TEXT,                  -- presented document plus the signature record
  issued_at INTEGER,                 -- when sent (Detcord's signature time)
  issued_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  signed_at INTEGER,
  signer_user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  signer_name TEXT,
  signer_title TEXT,
  signer_email TEXT,
  signer_ip TEXT,
  signer_ua TEXT,
  signature_id TEXT,
  voided_at INTEGER,
  void_reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX contracts_client ON contracts(client_id, created_at);

-- A signed contract can never change. Enforced in the database, not just the API.
CREATE TRIGGER contracts_signed_locked BEFORE UPDATE ON contracts
WHEN OLD.status = 'signed' AND (NEW.data IS NOT OLD.data OR NEW.presented_html IS NOT OLD.presented_html
  OR NEW.signed_html IS NOT OLD.signed_html OR NEW.document_hash IS NOT OLD.document_hash OR NEW.version IS NOT OLD.version
  OR NEW.signer_name IS NOT OLD.signer_name OR NEW.signed_at IS NOT OLD.signed_at)
BEGIN SELECT RAISE(ABORT, 'signed contracts are locked'); END;

CREATE TABLE invoices (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  contract_id TEXT REFERENCES contracts(id) ON DELETE SET NULL,
  number TEXT NOT NULL UNIQUE,
  kind TEXT NOT NULL DEFAULT 'custom' CHECK (kind IN ('deposit','setup','monthly','custom')),
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','paid','void')),
  total_cents INTEGER NOT NULL DEFAULT 0,
  paid_cents INTEGER NOT NULL DEFAULT 0,
  due_at INTEGER,
  issued_at INTEGER,
  paid_at INTEGER,
  notes TEXT,
  voided_at INTEGER,
  void_reason TEXT,
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX invoices_client ON invoices(client_id, created_at);
CREATE INDEX invoices_status ON invoices(status, due_at);

CREATE TABLE invoice_lines (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'other' CHECK (kind IN ('setup','monthly','deposit','credit','other')),
  description TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_cents INTEGER NOT NULL,       -- negative for credits (e.g. deposit already paid)
  position INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX invoice_lines_invoice ON invoice_lines(invoice_id, position);

-- Clover Hosted Checkout sessions we created. Payment is never trusted from the browser.
CREATE TABLE checkout_sessions (
  id TEXT PRIMARY KEY,               -- Clover checkoutSessionId
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount_cents INTEGER NOT NULL,
  href TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','paid','declined')),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER
);
CREATE INDEX checkout_sessions_invoice ON checkout_sessions(invoice_id);

CREATE TABLE payments (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('clover','manual')),
  provider_payment_id TEXT,          -- Clover payment UUID; unique so repeated webhooks cannot double count
  checkout_session_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('approved','declined')),
  amount_cents INTEGER NOT NULL,
  method TEXT,                       -- manual: check, cash, ACH...
  reference TEXT,
  message TEXT,
  recorded_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  received_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX payments_provider_id ON payments(provider, provider_payment_id) WHERE provider_payment_id IS NOT NULL;
CREATE INDEX payments_invoice ON payments(invoice_id);

-- Raw webhook deliveries, kept for audit and replay protection.
CREATE TABLE webhook_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  signature_ok INTEGER NOT NULL,
  body TEXT NOT NULL,
  outcome TEXT,
  received_at INTEGER NOT NULL
);

-- Shared client files, stored in R2. `shared` files are visible to the client; `internal` only to staff.
CREATE TABLE media (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  uploader_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL UNIQUE,
  visibility TEXT NOT NULL CHECK (visibility IN ('shared','internal')),
  purpose TEXT NOT NULL DEFAULT 'other' CHECK (purpose IN ('logo','photo','flyer','document','report','contract','website','social','other')),
  note TEXT,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX media_client ON media(client_id, created_at);
