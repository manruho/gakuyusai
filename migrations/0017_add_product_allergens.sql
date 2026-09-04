-- 公開ページの商品別アレルギー情報を、提供された成分一覧に合わせて更新する。
-- 商品名の表記揺れと、現行の商品IDの両方に対応する。
UPDATE products
SET allergy_text = CASE
  WHEN id = 'onigiri_shio' OR display_name IN ('塩', '塩むすび') THEN '該当なし'
  WHEN id = 'onigiri_ume_official' OR display_name = '梅' THEN '該当なし'
  WHEN id = 'onigiri_okaka_official' OR display_name IN ('おかか', 'おかか佃煮') THEN '小麦、大豆、さば'
  WHEN id = 'onigiri_shiso_kombu' OR display_name = 'しそ昆布' THEN '小麦、ごま'
  WHEN id = 'onigiri_takana_chirimen' OR display_name = '高菜ちりめん' THEN '小麦、大豆、ごま'
  WHEN id = 'onigiri_sake_official' OR display_name = '鮭' THEN 'さけ'
  WHEN id = 'onigiri_tuna_mayo_official' OR display_name = 'ツナマヨ' THEN '小麦、卵、乳、大豆'
  WHEN display_name = '梅ひじき' THEN '小麦、大豆、ごま'
  WHEN display_name IN ('だし巻き', 'だし巻き玉子') THEN '小麦、卵、大豆'
  WHEN id = 'onigiri_tori_soboro' OR display_name IN ('鶏そぼろ', 'とりそぼろ') THEN '小麦、大豆、鶏肉'
  WHEN display_name = '生のり佃煮' THEN 'えび、かに、小麦、大豆'
  WHEN display_name = '京みぶな' THEN 'かに、小麦、大豆'
  WHEN id = 'onigiri_ebi_mayo' OR display_name = 'エビマヨ' THEN 'えび、かに、卵、乳、大豆、りんご'
  WHEN display_name = 'ビーフ' THEN '小麦、大豆、豚肉、牛肉'
  WHEN id = 'onigiri_yaki_tarako' OR display_name = '焼きたらこ' THEN '卵（魚卵）'
  WHEN id = 'onigiri_karashi_mentaiko' OR display_name IN ('辛子明太', '辛子明太子') THEN '小麦、卵（魚卵）、大豆'
  WHEN id = 'onigiri_kinira_nikumiso' OR display_name IN ('黄ニラ肉みそ', '黄にら肉味噌') THEN '小麦、大豆、鶏肉、豚肉'
  WHEN id = 'onigiri_chanja' OR display_name IN ('チャンじゃ', 'チャンジャ') THEN 'えび、かに、小麦、卵、乳、大豆、ごま'
  WHEN display_name = '煮卵' THEN '小麦、卵、大豆'
  WHEN id = 'onigiri_nibuta_chashu' OR display_name = '煮豚チャーシュー' THEN '小麦、卵、乳、大豆、豚肉'
  WHEN id = 'onigiri_ebi_tenmusu' OR display_name IN ('エビ天むす', 'えび天むす') THEN 'えび、小麦、卵、乳、大豆、さば、いか'
  WHEN id = 'onigiri_teriyaki_chicken' OR display_name = '照り焼きチキン' THEN '小麦、卵、乳、大豆、鶏肉'
  WHEN display_name = 'からあげむすび' THEN '小麦、卵、大豆、鶏肉'
  WHEN display_name = 'とりめし' THEN '小麦、卵、大豆、鶏肉、さば'
  WHEN display_name = 'のり弁' THEN '小麦、卵、乳、大豆、鶏肉、さば'
  WHEN display_name IN ('ふつから', '唐揚げ') OR id = 'side_karaage_official' THEN '小麦、大豆、鶏肉'
  WHEN display_name = 'あまから' THEN '小麦、大豆、鶏肉、豚肉、ごま、ゼラチン'
  WHEN display_name = 'マヨから' THEN '小麦、卵、乳、大豆、鶏肉'
  WHEN display_name = 'コールスロー' THEN '小麦、卵、大豆'
  WHEN display_name = '大根サラダ' THEN '該当なし'
  WHEN display_name = '和風ドレ' THEN '小麦、大豆、豚肉'
  WHEN display_name = 'ごまドレ' THEN '小麦、卵、大豆、ごま'
  WHEN display_name = 'ポテトサラダ' THEN '卵、大豆'
  WHEN display_name = '牛肉コロッケ' THEN '小麦、卵、大豆、牛肉、ゼラチン'
  WHEN display_name = '野菜コロッケ' THEN '小麦、卵、乳、大豆、豚肉'
  WHEN display_name = 'みそ汁' THEN 'えび、小麦、そば、卵、乳、大豆、鶏肉'
  WHEN display_name = '豚汁' THEN '大豆、豚肉'
  WHEN display_name = 'マヨネーズ' THEN '卵、大豆'
  WHEN display_name = 'わさびふりかけ' THEN '大豆、ごま'
  WHEN display_name = 'チーズ' THEN '乳'
  ELSE allergy_text
END,
updated_at = datetime('now')
WHERE id IN (
  'onigiri_shio', 'onigiri_ume_official', 'onigiri_okaka_official',
  'onigiri_shiso_kombu', 'onigiri_takana_chirimen', 'onigiri_sake_official',
  'onigiri_tuna_mayo_official', 'onigiri_tori_soboro', 'onigiri_ebi_mayo',
  'onigiri_yaki_tarako', 'onigiri_karashi_mentaiko', 'onigiri_kinira_nikumiso',
  'onigiri_chanja', 'onigiri_nibuta_chashu', 'onigiri_ebi_tenmusu',
  'onigiri_teriyaki_chicken', 'side_karaage_official'
)
OR display_name IN (
  '塩', '塩むすび', '梅', 'おかか', 'おかか佃煮', 'しそ昆布', '高菜ちりめん',
  '鮭', 'ツナマヨ', '梅ひじき', 'だし巻き', 'だし巻き玉子', '鶏そぼろ',
  'とりそぼろ', '生のり佃煮', '京みぶな', 'エビマヨ', 'ビーフ', '焼きたらこ',
  '辛子明太', '辛子明太子', '黄ニラ肉みそ', '黄にら肉味噌', 'チャンじゃ',
  'チャンジャ', '煮卵', '煮豚チャーシュー', 'エビ天むす', 'えび天むす',
  '照り焼きチキン', 'からあげむすび', 'とりめし', 'のり弁', 'ふつから',
  '唐揚げ', 'あまから', 'マヨから', 'コールスロー', '大根サラダ', '和風ドレ',
  'ごまドレ', 'ポテトサラダ', '牛肉コロッケ', '野菜コロッケ', 'みそ汁',
  '豚汁', 'マヨネーズ', 'わさびふりかけ', 'チーズ'
);
