-- Each person's own arrangement of dashboard cards, per page.
CREATE TABLE user_layouts (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  page TEXT NOT NULL,
  layout TEXT NOT NULL,            -- JSON: { top, main, side, hidden: [cardId] }
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, page)
);
