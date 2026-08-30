CREATE TABLE IF NOT EXISTS sale_cancellations (
  sale_id TEXT PRIMARY KEY,
  canceled_at TEXT NOT NULL,
  canceled_by_username TEXT NOT NULL,
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);
