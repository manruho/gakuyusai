ALTER TABLE fulfillment_orders ADD COLUMN pickup_date TEXT;

UPDATE fulfillment_orders
SET pickup_date = business_date
WHERE pickup_date IS NULL;

CREATE INDEX IF NOT EXISTS idx_fulfillment_pickup_date_sale_type
  ON fulfillment_orders(pickup_date, sale_id, status);

-- 前売りID（6文字）だけを全期間で一意にする。通常注文番号（4文字）は
-- 既存仕様どおり営業日単位の一意性を維持する。
CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_pickup_code_presale_global
  ON fulfillment_orders(pickup_code)
  WHERE length(pickup_code) = 6;
