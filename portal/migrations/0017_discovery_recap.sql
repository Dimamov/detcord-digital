-- Discovery answers the rep hasn't confirmed yet, and the client questionnaire.
-- marks: { questionId | 'industry': { source: 'client-record'|'intake'|'audit'|'client', at, note? } }. An answer with a
--   mark was filled in by the portal or the client; the rep confirming or editing it removes the mark.
-- suggestions: { questionId: { value, at } }: client answers to questions the rep already owns. Never applied automatically.
-- client_answers: everything the client entered in their questionnaire, in their words, as they last left it.
ALTER TABLE discoveries ADD COLUMN marks TEXT NOT NULL DEFAULT '{}';
ALTER TABLE discoveries ADD COLUMN suggestions TEXT NOT NULL DEFAULT '{}';
ALTER TABLE discoveries ADD COLUMN client_answers TEXT NOT NULL DEFAULT '{}';
ALTER TABLE discoveries ADD COLUMN client_invited_at INTEGER;
ALTER TABLE discoveries ADD COLUMN client_submitted_at INTEGER;
