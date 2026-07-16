PRAGMA foreign_keys=off;

CREATE TABLE sales_new (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  sale_type TEXT NOT NULL CHECK (sale_type IN ('normal', 'presale_pickup')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  paid_amount INTEGER NOT NULL CHECK (paid_amount >= 0),
  change_amount INTEGER NOT NULL CHECK (change_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'prepaid')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'canceled')),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('staff', 'admin', 'owner')),
  created_at TEXT NOT NULL,
  canceled_at TEXT
);

INSERT INTO sales_new (
  id, idempotency_key, sale_type, total_amount, paid_amount, change_amount,
  payment_method, status, created_by_role, created_at, canceled_at
)
SELECT
  id, idempotency_key, sale_type, total_amount, paid_amount, change_amount,
  payment_method, status, created_by_role, created_at, canceled_at
FROM sales;

CREATE TABLE sale_items_backup (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL,
  unit_price INTEGER NOT NULL,
  subtotal INTEGER NOT NULL
);

INSERT INTO sale_items_backup (
  id, sale_id, product_id, quantity, unit_price, subtotal
)
SELECT
  id, sale_id, product_id, quantity, unit_price, subtotal
FROM sale_items;

CREATE TABLE stock_events_backup (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  quantity_delta INTEGER NOT NULL,
  related_sale_id TEXT,
  reason TEXT NOT NULL,
  created_by_role TEXT NOT NULL,
  created_at TEXT NOT NULL
);

INSERT INTO stock_events_backup (
  id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at
)
SELECT
  id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at
FROM stock_events;

DROP TABLE stock_events;
DROP TABLE sale_items;
DROP TABLE sales;

ALTER TABLE sales_new RENAME TO sales;

CREATE TABLE sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

INSERT INTO sale_items (
  id, sale_id, product_id, quantity, unit_price, subtotal
)
SELECT
  id, sale_id, product_id, quantity, unit_price, subtotal
FROM sale_items_backup;

CREATE TABLE stock_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('initial', 'sale', 'presale_pickup', 'cancel', 'restock', 'discard', 'adjust')
  ),
  quantity_delta INTEGER NOT NULL,
  related_sale_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('staff', 'admin', 'owner')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (related_sale_id) REFERENCES sales(id)
);

INSERT INTO stock_events (
  id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at
)
SELECT
  id, product_id, event_type, quantity_delta, related_sale_id, reason, created_by_role, created_at
FROM stock_events_backup;

DROP TABLE sale_items_backup;
DROP TABLE stock_events_backup;

CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_events_product_id ON stock_events(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_events_created_at ON stock_events(created_at);

PRAGMA foreign_keys=on;
