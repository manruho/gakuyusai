ALTER TABLE sales ADD COLUMN register_id INTEGER NOT NULL DEFAULT 1 CHECK (register_id BETWEEN 1 AND 4);
ALTER TABLE sales ADD COLUMN cancel_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE sales ADD COLUMN cancel_restore_stock INTEGER;
ALTER TABLE sales ADD COLUMN canceled_by_username TEXT;

CREATE TABLE IF NOT EXISTS fulfillment_orders (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  register_id INTEGER NOT NULL CHECK (register_id BETWEEN 1 AND 4),
  station_id INTEGER NOT NULL CHECK (station_id BETWEEN 1 AND 4),
  pickup_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'delivered', 'canceled')),
  delivered_at TEXT,
  delivered_by_username TEXT,
  canceled_at TEXT,
  cancel_acknowledged_at TEXT,
  cancel_acknowledged_by_username TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (business_date, pickup_code),
  CHECK (register_id = station_id),
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS fulfillment_events (
  id TEXT PRIMARY KEY,
  fulfillment_order_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('created', 'delivered', 'restored', 'canceled', 'cancel_acknowledged')),
  from_status TEXT,
  to_status TEXT,
  actor_role TEXT NOT NULL CHECK (actor_role IN ('staff', 'pickup', 'admin', 'owner')),
  actor_username TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  metadata_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (fulfillment_order_id) REFERENCES fulfillment_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_sales_register_created ON sales(register_id, created_at);
CREATE INDEX IF NOT EXISTS idx_fulfillment_station_status_created ON fulfillment_orders(station_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_fulfillment_business_code ON fulfillment_orders(business_date, pickup_code);
CREATE INDEX IF NOT EXISTS idx_fulfillment_events_order_created ON fulfillment_events(fulfillment_order_id, created_at);
