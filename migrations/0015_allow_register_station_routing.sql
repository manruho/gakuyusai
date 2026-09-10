-- 販売レジと受取場所を分離する。前売り券はどのレジで販売しても受取4へ送る。
PRAGMA defer_foreign_keys = ON;

CREATE TABLE fulfillment_orders_new (
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
  pickup_date TEXT,
  UNIQUE (business_date, pickup_code),
  FOREIGN KEY (sale_id) REFERENCES sales(id)
);

INSERT INTO fulfillment_orders_new (
  id, sale_id, business_date, register_id, station_id, pickup_code, status,
  delivered_at, delivered_by_username, canceled_at, cancel_acknowledged_at,
  cancel_acknowledged_by_username, created_at, updated_at, pickup_date
)
SELECT
  id, sale_id, business_date, register_id, station_id, pickup_code, status,
  delivered_at, delivered_by_username, canceled_at, cancel_acknowledged_at,
  cancel_acknowledged_by_username, created_at, updated_at, pickup_date
FROM fulfillment_orders;

DROP TABLE fulfillment_orders;
ALTER TABLE fulfillment_orders_new RENAME TO fulfillment_orders;

CREATE INDEX IF NOT EXISTS idx_fulfillment_station_status_created
  ON fulfillment_orders(station_id, status, created_at);
CREATE INDEX IF NOT EXISTS idx_fulfillment_business_code
  ON fulfillment_orders(business_date, pickup_code);
CREATE INDEX IF NOT EXISTS idx_fulfillment_pickup_date_sale_type
  ON fulfillment_orders(pickup_date, sale_id, status);
CREATE INDEX IF NOT EXISTS idx_fulfillment_station_pickup_date_status_created
  ON fulfillment_orders(station_id, pickup_date, status, created_at);
CREATE INDEX IF NOT EXISTS idx_fulfillment_pickup_date_status_created
  ON fulfillment_orders(pickup_date, status, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_pickup_code_presale_global
  ON fulfillment_orders(pickup_code)
  WHERE length(pickup_code) = 6;

PRAGMA defer_foreign_keys = OFF;
