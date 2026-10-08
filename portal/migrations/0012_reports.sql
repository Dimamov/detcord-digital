-- Monthly client reports: drafted by Claude from what the portal recorded for one client and one month,
-- edited by staff, then shared. Clients only ever see shared reports.
CREATE TABLE monthly_reports (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  month TEXT NOT NULL,              -- YYYY-MM in the client's time zone
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','ready','shared')),
  facts TEXT NOT NULL,              -- JSON snapshot of the portal data the report was built from
  draft TEXT,                       -- JSON exactly as Claude returned it; null when staff write it by hand
  draft_source TEXT NOT NULL CHECK (draft_source IN ('ai','staff')),
  content TEXT NOT NULL,            -- JSON: headline, summary, sections, next_month, staff_notes (the version staff edit and share)
  edited INTEGER NOT NULL DEFAULT 0,-- staff changed the content after it was generated
  meeting_notes INTEGER NOT NULL DEFAULT 0, -- staff chose to include meeting summaries in the facts
  error TEXT,                       -- why Claude could not draft it, for staff only
  generated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  generated_at INTEGER NOT NULL,
  edited_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  edited_at INTEGER,
  shared_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  shared_at INTEGER,
  unshared_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  unshared_at INTEGER,
  delivery TEXT,                    -- JSON: the share emails [{ name, email, status, error }]
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (client_id, month)
);
CREATE INDEX monthly_reports_client ON monthly_reports(client_id, month);
CREATE INDEX monthly_reports_shared ON monthly_reports(status, shared_at);
