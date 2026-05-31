PRAGMA foreign_keys = OFF;

DROP TABLE IF EXISTS sale_items;
DROP TABLE IF EXISTS stock_events;
DROP TABLE IF EXISTS sales;
DROP TABLE IF EXISTS product_inventory;
DROP TABLE IF EXISTS settings;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS orders;

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  initial_stock INTEGER NOT NULL CHECK (initial_stock >= 0),
  is_public INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  allergy_text TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS product_inventory (
  product_id TEXT PRIMARY KEY,
  current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  sale_type TEXT NOT NULL CHECK (sale_type IN ('normal', 'presale_pickup')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  paid_amount INTEGER NOT NULL CHECK (paid_amount >= 0),
  change_amount INTEGER NOT NULL CHECK (change_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'prepaid')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'canceled')),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'owner')),
  created_at TEXT NOT NULL,
  canceled_at TEXT
);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);

CREATE TABLE IF NOT EXISTS stock_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('initial', 'sale', 'presale_pickup', 'cancel', 'restock', 'discard', 'adjust')
  ),
  quantity_delta INTEGER NOT NULL,
  related_sale_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'owner')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (related_sale_id) REFERENCES sales(id)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products(sort_order);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_events_product_id ON stock_events(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_events_created_at ON stock_events(created_at);

INSERT INTO products (
  id, name, display_name, price, initial_stock,
  is_public, is_active, sort_order,
  allergy_text, description, note,
  created_at, updated_at
) VALUES
(
  'yakisoba',
  'yakisoba',
  '焼きそば',
  300,
  100,
  1,
  1,
  1,
  '小麦、卵',
  '',
  '同じ調理場で乳を含む商品を扱っています。',
  datetime('now'),
  datetime('now')
),
(
  'drink',
  'drink',
  'ドリンク',
  150,
  120,
  1,
  1,
  2,
  '',
  '',
  '',
  datetime('now'),
  datetime('now')
);

INSERT INTO product_inventory (
  product_id, current_stock, updated_at
) VALUES
('yakisoba', 100, datetime('now')),
('drink', 120, datetime('now'));

INSERT INTO settings (
  key, value, updated_at
) VALUES
('shop_name', '文化祭食品販売', datetime('now')),
('public_status_enabled', 'true', datetime('now')),
('sales_open', 'true', datetime('now')),
('timezone', 'Asia/Tokyo', datetime('now'));

PRAGMA foreign_keys = ON;

