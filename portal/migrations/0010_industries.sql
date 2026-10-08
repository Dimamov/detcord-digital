-- Industries staff add at intake when none of the built-in ones fit. They use the general discovery questions.
CREATE TABLE custom_industries (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  name_key TEXT NOT NULL UNIQUE,
  created_by TEXT REFERENCES users(id),
  created_at INTEGER NOT NULL
);
