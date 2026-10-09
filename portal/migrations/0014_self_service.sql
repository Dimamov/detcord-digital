-- Client self-service: business owners manage their own team logins, and clients ask for new services.

-- Owners can invite, remove and promote teammates. Staff set the flag from Portal access.
ALTER TABLE client_members ADD COLUMN is_owner INTEGER NOT NULL DEFAULT 0;
ALTER TABLE client_members ADD COLUMN created_at INTEGER;

-- Existing businesses: the earliest login of each becomes its owner.
UPDATE client_members SET is_owner = 1
WHERE user_id = (
  SELECT m.user_id FROM client_members m JOIN users u ON u.id = m.user_id
  WHERE m.client_id = client_members.client_id ORDER BY u.created_at, u.id LIMIT 1
);

-- "Request a service" from the client's Business page. Staff quote it outside the portal; marking it
-- added changes nothing else (services and agreements stay with staff).
CREATE TABLE service_requests (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  requested_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  services TEXT NOT NULL,           -- JSON [{ id, name }] as the catalog named them when asked; never prices
  note TEXT,                        -- the client's note
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','quoted','added','declined')),
  reply TEXT,                       -- optional note from staff, shown to the client
  updated_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX service_requests_client ON service_requests(client_id, created_at);
CREATE INDEX service_requests_status ON service_requests(status, created_at);
