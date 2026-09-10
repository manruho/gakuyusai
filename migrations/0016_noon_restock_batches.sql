CREATE TABLE IF NOT EXISTS stock_restock_batches (
  id TEXT PRIMARY KEY,
  batch_key TEXT NOT NULL,
  business_date TEXT NOT NULL,
  item_count INTEGER NOT NULL CHECK (item_count > 0),
  total_quantity INTEGER NOT NULL CHECK (total_quantity > 0),
  applied_by_role TEXT NOT NULL CHECK (applied_by_role IN ('admin', 'owner')),
  applied_by_username TEXT NOT NULL,
  applied_at TEXT NOT NULL,
  UNIQUE (batch_key, business_date)
);

CREATE INDEX IF NOT EXISTS idx_stock_restock_batches_date
  ON stock_restock_batches(business_date, applied_at);
