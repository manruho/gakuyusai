ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT '';

UPDATE products
SET category = CASE
  WHEN id LIKE 'onigiri_%' THEN 'おにぎり'
  WHEN id LIKE 'side_%' THEN 'サイドメニュー'
  WHEN id LIKE 'drink_%' THEN '飲み物'
  ELSE 'アーカイブ'
END,
is_public = CASE
  WHEN id LIKE 'onigiri_%' OR id LIKE 'side_%' OR id LIKE 'drink_%' THEN 1
  ELSE 0
END,
is_active = CASE
  WHEN id LIKE 'onigiri_%' OR id LIKE 'side_%' OR id LIKE 'drink_%' THEN 1
  ELSE 0
END;

INSERT OR IGNORE INTO products (
  id, name, display_name, category, price, initial_stock,
  is_public, is_active, sort_order,
  allergy_text, description, note,
  created_at, updated_at
) VALUES
(
  'onigiri_salmon',
  'onigiri_salmon',
  '鮭おにぎり',
  'おにぎり',
  180,
  80,
  1,
  1,
  1,
  '',
  '定番で食べやすい、王道の一品。',
  '',
  datetime('now'),
  datetime('now')
),
(
  'onigiri_ume',
  'onigiri_ume',
  '梅しそおにぎり',
  'おにぎり',
  180,
  70,
  1,
  1,
  2,
  '',
  'さっぱりしていて、暑い日でも食べやすい。',
  '',
  datetime('now'),
  datetime('now')
),
(
  'onigiri_tuna_mayo',
  'onigiri_tuna_mayo',
  'ツナマヨおにぎり',
  'おにぎり',
  200,
  70,
  1,
  1,
  3,
  '卵、乳、大豆',
  '子どもから大人まで人気の定番。',
  '',
  datetime('now'),
  datetime('now')
),
(
  'onigiri_okaka',
  'onigiri_okaka',
  'おかかおにぎり',
  'おにぎり',
  180,
  60,
  1,
  1,
  4,
  '小麦、大豆',
  '香ばしい風味で食べやすい。',
  '',
  datetime('now'),
  datetime('now')
),
(
  'side_tamagoyaki',
  'side_tamagoyaki',
  'だし巻き玉子',
  'サイドメニュー',
  220,
  40,
  1,
  1,
  10,
  '卵、小麦',
  'おにぎりと一緒に選びやすい副菜。',
  '',
  datetime('now'),
  datetime('now')
),
(
  'side_karaage',
  'side_karaage',
  '唐揚げ',
  'サイドメニュー',
  280,
  50,
  1,
  1,
  11,
  '卵、小麦、鶏肉',
  '熱々で満足感のある人気のサイド。',
  '',
  datetime('now'),
  datetime('now')
),
(
  'drink_mugicha',
  'drink_mugicha',
  '麦茶',
  '飲み物',
  120,
  120,
  1,
  1,
  20,
  '',
  'すっきり飲める定番ドリンク。',
  '',
  datetime('now'),
  datetime('now')
),
(
  'drink_ramune',
  'drink_ramune',
  'ラムネ',
  '飲み物',
  150,
  90,
  1,
  1,
  21,
  '',
  'お祭り感のある定番の一本。',
  '',
  datetime('now'),
  datetime('now')
);

INSERT OR IGNORE INTO product_inventory (
  product_id, current_stock, updated_at
) VALUES
('onigiri_salmon', 80, datetime('now')),
('onigiri_ume', 70, datetime('now')),
('onigiri_tuna_mayo', 70, datetime('now')),
('onigiri_okaka', 60, datetime('now')),
('side_tamagoyaki', 40, datetime('now')),
('side_karaage', 50, datetime('now')),
('drink_mugicha', 120, datetime('now')),
('drink_ramune', 90, datetime('now'));
