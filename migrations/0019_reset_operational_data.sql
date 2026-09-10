-- 運用データを初期化する。商品マスタ・商品設定・アカウント設定は保持する。
-- 在庫は各商品の initial_stock に戻し、初期化前の履歴は残さない。

DELETE FROM fulfillment_events;
DELETE FROM fulfillment_orders;
DELETE FROM checkout_draft_items;
DELETE FROM checkout_drafts;
DELETE FROM sale_items;
DELETE FROM sale_cancellations;
DELETE FROM stock_events;
DELETE FROM stock_restock_batches;
DELETE FROM sales;

UPDATE product_inventory
SET current_stock = (
      SELECT p.initial_stock
      FROM products p
      WHERE p.id = product_inventory.product_id
    ),
    updated_at = datetime('now')
WHERE EXISTS (
  SELECT 1
  FROM products p
  WHERE p.id = product_inventory.product_id
);
