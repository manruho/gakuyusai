-- 前売りは商品ごとに初期在庫の30%（切り捨て）までとする。
-- Worker側の事前検証に加え、同時販売でも上限を超えないようDBで最終検証する。
CREATE TRIGGER IF NOT EXISTS trg_sale_items_presale_limit
BEFORE INSERT ON sale_items
WHEN (
  SELECT sale_type
  FROM sales
  WHERE id = NEW.sale_id
) = 'presale_pickup'
AND COALESCE((
  SELECT SUM(si.quantity)
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
  WHERE si.product_id = NEW.product_id
    AND s.sale_type = 'presale_pickup'
    AND s.status = 'completed'
), 0) + NEW.quantity > COALESCE((
  SELECT CAST(initial_stock * 3 / 10 AS INTEGER)
  FROM products
  WHERE id = NEW.product_id
), 0)
BEGIN
  SELECT RAISE(ABORT, 'PRESALE_LIMIT_EXCEEDED');
END;
