CREATE TABLE IF NOT EXISTS checkout_drafts (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  register_id INTEGER NOT NULL CHECK (register_id BETWEEN 1 AND 4),
  station_id INTEGER NOT NULL CHECK (station_id BETWEEN 1 AND 4),
  sale_type TEXT NOT NULL CHECK (sale_type = 'normal'),
  pickup_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'awaiting_payment'
    CHECK (status IN ('awaiting_payment', 'completed', 'canceled', 'expired')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  sale_id TEXT UNIQUE,
  expires_at TEXT NOT NULL,
  canceled_at TEXT,
  cancel_reason TEXT NOT NULL DEFAULT '',
  cancel_acknowledged_at TEXT,
  cancel_acknowledged_by_username TEXT,
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('staff', 'admin', 'owner')),
  created_by_username TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_date, pickup_code),
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS checkout_draft_items (
  id TEXT PRIMARY KEY,
  draft_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  UNIQUE (draft_id, product_id),
  FOREIGN KEY (draft_id) REFERENCES checkout_drafts(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE INDEX IF NOT EXISTS idx_checkout_drafts_station_status_created
  ON checkout_drafts(station_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_checkout_drafts_status_expires
  ON checkout_drafts(status, expires_at);
CREATE INDEX IF NOT EXISTS idx_checkout_draft_items_product
  ON checkout_draft_items(product_id, draft_id);
