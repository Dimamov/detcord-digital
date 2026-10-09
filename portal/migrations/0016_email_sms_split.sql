-- Splits "Email and SMS marketing" into two services. email-sms is retired (inactive), never deleted,
-- so existing client services, deals and agreements that name it keep working.
INSERT OR IGNORE INTO services (id, name, category, description, position) VALUES
  ('email', 'Email marketing', 'convert', 'Campaigns, newsletters and automated flows that turn past customers and leads into repeat jobs, with list hygiene and CAN-SPAM compliance.', 9),
  ('sms', 'SMS marketing', 'convert', 'Text offers, reminders and win-back messages to customers who opted in, with consent records and STOP handling built in.', 9);
UPDATE services SET active=0 WHERE id='email-sms';
