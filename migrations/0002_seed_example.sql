-- 0001_initial.sql が作成したスキーマへ、開発用の初期データだけを投入する。
-- 既存の販売・在庫・設定データを削除してはならない。
INSERT OR IGNORE INTO products (
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

INSERT OR IGNORE INTO product_inventory (
  product_id, current_stock, updated_at
) VALUES
('yakisoba', 100, datetime('now')),
('drink', 120, datetime('now'));

INSERT OR IGNORE INTO settings (
  key, value, updated_at
) VALUES
('shop_name', '文化祭食品販売', datetime('now')),
('public_status_enabled', 'true', datetime('now')),
('sales_open', 'true', datetime('now')),
('timezone', 'Asia/Tokyo', datetime('now'));

