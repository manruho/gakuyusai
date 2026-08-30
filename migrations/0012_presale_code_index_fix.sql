-- 0010 の旧版で作られた全注文番号のグローバル一意 index を除去する。
-- 前売りID（6文字）のみは、営業日をまたいでも再利用しない。
DROP INDEX IF EXISTS idx_fulfillment_pickup_code_global;

CREATE UNIQUE INDEX IF NOT EXISTS idx_fulfillment_pickup_code_presale_global
  ON fulfillment_orders(pickup_code)
  WHERE length(pickup_code) = 6;
