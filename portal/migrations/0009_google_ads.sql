-- A client's Google Ads account and the link request from Detcord's manager account (MCC).
ALTER TABLE clients ADD COLUMN ads_customer_id TEXT;          -- 10 digits, no dashes
ALTER TABLE clients ADD COLUMN ads_link_status TEXT;          -- waiting_setup | pending | active | refused | cancelled | inactive | failed
ALTER TABLE clients ADD COLUMN ads_link_error TEXT;
ALTER TABLE clients ADD COLUMN ads_link_requested_at INTEGER;
ALTER TABLE clients ADD COLUMN ads_link_requested_by TEXT REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE clients ADD COLUMN ads_link_checked_at INTEGER;
