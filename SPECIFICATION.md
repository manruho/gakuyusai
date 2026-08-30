# gakuyusai 仕様書

文化祭食品販売システムの目的、画面、API、データ構造、運用ルールを、`plan.md` と現行ソースコードの両方に基づいて整理した仕様書です。

> この文書は 2026-07-16 時点のリポジトリを対象にしています。`plan.md` は実装方針、ソースコードは現行動作の根拠として扱っています。両者が異なる箇所は「現行実装との差分」に明記します。

## 1. システム概要

### 1.1 目的

文化祭で扱う食品の販売を、次の機能で支援する軽量な Web アプリケーションです。

- 一般客への商品・価格・アレルギー情報・段階的な在庫状況の公開
- スタッフが使う現金レジ
- 事前販売分の受け渡し記録
- 管理者による在庫の補充、廃棄、補正、履歴確認
- 売上履歴と在庫イベントの CSV 出力
- 商品マスタ、公開状態、ログイン情報、在庫表示しきい値の管理

正確な在庫数は一般客には公開せず、「売り切れ」「すくなめ」「まだある」「たっぷり」のような段階表示に変換します。QR コードから公開ページを開き、スタッフ向け URL とは分離して利用する想定です。

### 1.2 対象ユーザー

| ロール | 主な利用者 | 主な責務 |
| --- | --- | --- |
| `public` | 一般客 | 商品、価格、アレルギー、在庫段階の閲覧 |
| `staff` | レジ担当 | 商品選択、会計、前売り券の販売 |
| `admin` | 運用担当 | `staff` の機能、在庫操作、販売履歴、集計、CSV |
| `owner` | 管理担当 | `admin` の機能、商品マスタ、公開設定、アカウント設定 |

### 1.3 非対象

- 電子決済
- 個人アカウント単位のユーザー管理
- 予約注文の受付・管理
- 完全オフラインでの同期
- Google Sheets、Firebase、localStorage、JSON ファイルをデータベースとして使うこと

## 2. 技術構成

| 層 | 採用技術 |
| --- | --- |
| フロントエンド | React 19 / TypeScript |
| ビルド | Vite |
| ルーティング | React Router |
| API | Cloudflare Pages Functions 経由の Hono アプリ |
| バリデーション | Zod（一部 API 入力） |
| データベース | Cloudflare D1（SQLite） |
| 認証 | HttpOnly Cookie に保存する署名セッション |
| テスト | Vitest、Testing Library、Playwright 構成 |
| デプロイ | Cloudflare Pages、Wrangler |

主な実装箇所は次のとおりです。

```text
src/                     React UI と共通型・計算ロジック
  app/App.tsx            画面ルーティング
  app/routes/            公開、ログイン、レジ、在庫、管理画面
  lib/                   金額、在庫段階、認証関連の共通処理
worker/app.ts            Hono の API と認可
worker/services/         販売、在庫、認証、CSV の業務処理
worker/db/               D1 クエリと型
functions/api/           Pages Functions のエントリポイント
migrations/              D1 スキーマと初期データ
tests/unit/              単体テスト
wrangler.jsonc           Cloudflare Pages / D1 設定（正）
```

## 3. 画面仕様

### 3.1 公開ページ `/`

認証不要の一般客向けページです。

- 店舗名を表示する。D1 の `shop_name` または `PUBLIC_SHOP_NAME` を使用する
- 最終更新時刻を表示する
- 公開状態と売り切れ商品数を表示する
- 商品を「おにぎり」「サイドメニュー」「飲み物」で切り替える
- 商品名、価格、アレルギー、説明、在庫段階を表示する
- 正確な在庫数は表示しない
- 売り切れ商品は選択不可の見た目で表示する
- API から取得できない場合は、エラー文とフォールバック表示を出す
- 120 秒ごとに公開 API を再取得する

公開ページで使用する在庫段階は、初期在庫に対する現在在庫率で計算します。

| 条件 | `statusLevel` | 表示 |
| --- | ---: | --- |
| 現在在庫 `<= 0`、または初期在庫 `<= 0` | 0 | あとちょっとだよ / 売り切れ |
| 在庫率 `<= low` | 0 | あとちょっとだよ |
| 在庫率 `<= mid` | 1 | まだすこしのこってるよ |
| 在庫率 `<= high` | 2 | けっこうのこってるよ |
| 上記を超える | 3 | まだまだあるよ |

既定しきい値は `low=0.15`、`mid=0.35`、`high=0.65` です。D1 の `settings` に同名キーがあればそれを優先します。

### 3.2 ログイン `/login`

- `username` と `password` を入力する
- 成功時に署名セッション Cookie を発行する
- `staff` は `/staff/register` へ遷移する
- `admin` / `owner` は `/admin` へ遷移する
- 認証失敗時はユーザー名またはパスワードが違う旨を表示する
- 5 回以上の失敗で、ユーザー名と IP の組み合わせを 15 分ロックする

### 3.3 レジ `/staff/register`

`staff`、`admin`、`owner` が利用できる販売画面です。

#### 商品選択

- 商品をカテゴリ別に表示する
- 商品ごとに価格、在庫状況、販売可否を表示する
- 商品を追加、1 個減らす、選択から削除する
- 現在在庫を超える数量は追加できない
- 非アクティブ商品と売り切れ商品は追加できない
- 選択商品、数量、小計、合計を表示する

#### 会計

- 通常販売と事前販売を切り替える
- 通常販売は現金のみ。預かり金額が合計以上である必要がある
- 事前販売は1日目に現金を受け取る。支払方法は `cash` とし、合計以上の預かり金額が必要
- レジ1〜3は通常販売専用、レジ4は前売り販売専用。APIでも販売種別とレジ番号を検証する
- 預かり金額から釣銭を計算する
- 確定時にレシート情報と販売 ID を表示する
- 二重送信を防ぐため、会計単位で UUID の冪等キーを生成する
- 通信再試行時に同じ冪等キーが送られた場合、同じ販売結果を返す
- 管理権限を持つ利用者は、完了画面から販売取消を実行できる

#### 商品の受取 `/pickup`

- 受取1〜3は対応するレジの通常注文、受取4は前売り注文を一覧表示する
- 受取1〜3は当日が受取対象の注文だけを一覧表示し、受取4は予約確認のため本日以降が受取対象の前売り注文を一覧表示する
- 受取4の翌日以降の予約には受取日を表示し、受取済み操作は日本時間の受取日以降だけ許可する（APIでも検証する）
- 4文字の通常注文番号または6文字の前売りID、商品名で一覧を検索できる
- 注文内容を確認してから受取済みに更新する
- 受取済みIDは再度受け取れず、前売り注文はキャンセルできない
- 前売りIDと販売・受取イベントは削除せず保持する

### 3.4 在庫 `/staff/stock`

現行 UI は在庫一覧、補充、廃棄、補正記録、イベント履歴を表示します。

- 商品別の現在在庫を表示する
- `+5 補充` を記録する
- `-1 廃棄` を記録する
- `補正記録` は数量差分 0 のイベントを記録する
- イベント履歴を最大 100 件まで取得できる。画面の既定取得件数は 20 件
- 商品 ID、商品名、イベント種別、差分、理由、ロール、時刻などで検索する

### 3.5 管理画面 `/admin` および `/admin/*`

実装上、複数の URL は同じ `AdminPage` コンポーネントに集約されています。

- `/admin` 管理トップ
- `/admin/sales` 販売履歴
- `/admin/inventory` 在庫運用への導線
- `/admin/products` 商品マスタ
- `/admin/settings` 公開設定・アカウント設定

管理画面の機能は次のとおりです。

- 売上合計、完了販売件数、商品数、販売数量の集計表示
- 販売履歴の取得、検索、明細表示、取消状態確認
- 商品の名前、表示名、価格、初期在庫、公開フラグ、販売中フラグ、並び順、アレルギー、説明、注記の編集
- 公開状態の ON/OFF
- 販売状態の ON 操作
- 店舗名、ログイン名、在庫しきい値などの設定保存
- パスワードハッシュはブラウザへ返さず、Cloudflare Secrets で管理
- 在庫 CSV、売上 CSV、在庫イベント CSV の取得・ダウンロード

商品マスタと設定の API は `owner` のみ、販売履歴・集計・CSV・在庫操作は `admin` または `owner` のみが実行できます。

## 4. 認証・認可仕様

### 4.1 セッション

- ログイン成功時、`role`、`username`、有効期限 `exp` を署名する
- セッション有効期限は 12 時間
- Cookie 名は `session`
- 属性は `Path=/; HttpOnly; SameSite=Lax; Max-Age=43200`
- HTTPS 時は `Secure` を付加する
- ログアウトは Cookie の有効期限を 0 にして破棄する
- セッション署名鍵は `SESSION_SECRET` を使用し、未設定時はログインを拒否する

### 4.2 資格情報の解決順

ユーザー名は D1 `settings` を先に参照し、なければ Cloudflare 環境変数を参照します。パスワードハッシュは Cloudflare Secrets を正とし、移行互換性のため Secret が未設定の場合に限って既存の D1 設定へフォールバックします。D1 のパスワードハッシュは管理 API から取得・更新できません。

| ロール | 設定キー / 環境変数 |
| --- | --- |
| staff | `staff_username` / `STAFF_USERNAME`、`STAFF_PASSWORD_HASH` |
| admin | `admin_username` / `ADMIN_USERNAME`、`ADMIN_PASSWORD_HASH` |
| owner | `owner_username` / `OWNER_USERNAME`、`OWNER_PASSWORD_HASH` |
| pickup 1〜4 | `pickup_N_username` / `PICKUP_N_USERNAME`、`PICKUP_N_PASSWORD_HASH` |

パスワードは平文保存せず、`verifyPassword` でハッシュと照合します。

### 4.3 プレビュー認証バイパス

`PREVIEW_AUTH_BYPASS=true` かつ `CF_PAGES_BRANCH` が存在し `main` 以外の場合、プレビュー環境では仮想 `preview-staff` セッションを返します。本番ブランチではバイパスしません。

## 5. API 仕様

成功レスポンスは概ね `{ "ok": true, "data": ... }`、失敗レスポンスは `{ "ok": false, "error": { "code": ..., "message": ... } }` です。

| Method | Path | 認証 | 概要 |
| --- | --- | --- | --- |
| GET | `/api/health` | 不要 | ヘルスチェック |
| GET | `/api/schema` | 不要 | テーブル名の確認 |
| GET | `/api/public/status` | 不要 | 公開商品・段階在庫 |
| POST | `/api/auth/login` | 不要 | ログイン、Cookie 発行 |
| GET | `/api/auth/me` | 必須 | 現在のセッション取得 |
| POST | `/api/auth/logout` | 不要 | セッション破棄 |
| GET | `/api/staff/register/products` | staff/admin/owner | レジ商品一覧 |
| GET | `/api/register/products` | staff/admin/owner | 上記の互換エイリアス |
| POST | `/api/staff/register/checkout` | staff/admin/owner | 会計 |
| POST | `/api/sales` | staff/admin/owner | 会計の互換エイリアス |
| GET | `/api/staff/stock` | admin/owner | 在庫一覧 |
| GET | `/api/stock` | admin/owner | 在庫一覧の互換エイリアス |
| POST | `/api/staff/stock/event` | admin/owner | 補充・廃棄・補正 |
| POST | `/api/stock/events` | admin/owner | 在庫イベントの互換エイリアス |
| GET | `/api/staff/stock/history` | admin/owner | 在庫履歴。`limit` 1～100、`q` 対応 |
| POST | `/api/sales/:saleId/cancel` | admin/owner | 販売取消、在庫返却 |
| GET | `/api/admin/products` | owner | 商品一覧（管理用全項目） |
| POST | `/api/admin/products` | owner | 商品作成または ID 競合時更新 |
| PUT | `/api/admin/products/:id` | owner | 商品更新 |
| GET | `/api/admin/settings` | owner | 設定取得 |
| POST | `/api/admin/settings` | owner | 1 設定更新 |
| PUT | `/api/admin/settings` | owner | 複数設定更新 |
| GET | `/api/admin/sales` | admin/owner | 販売履歴。`q`、`limit` 1～500 |
| GET | `/api/admin/summary` | admin/owner | 売上・商品・数量集計 |
| GET | `/api/admin/csv` | admin/owner | 簡易在庫 CSV |
| GET | `/api/admin/export/sales.csv` | admin/owner | 売上明細 CSV（最大 1000 件） |
| GET | `/api/admin/export/stock-events.csv` | admin/owner | 在庫イベント CSV（最大 1000 件） |

### 5.1 会計リクエスト

```json
{
  "idempotencyKey": "uuid",
  "saleType": "normal",
  "paymentMethod": "cash",
  "paidAmount": 1000,
  "items": [
    { "productId": "onigiri_salmon", "quantity": 2 }
  ]
}
```

制約は次のとおりです。

- `items` は 1 件以上
- 商品 ID は空文字不可、数量は正の整数
- 商品価格は DB の現在値を使い、クライアントの価格は信用しない
- 通常販売は `paymentMethod=cash` かつ `paidAmount >= totalAmount`
- 事前販売は `paymentMethod=cash` かつ `paidAmount >= totalAmount`
- 在庫不足は HTTP 409
- 商品不存在は HTTP 404
- 入力不正、支払方法不一致、支払不足は HTTP 400

会計成功時には `sales`、`sale_items`、`product_inventory` の減算、`stock_events` の販売イベントをまとめて D1 batch で登録します。

### 5.2 在庫イベント

```json
{
  "productId": "onigiri_salmon",
  "quantityDelta": 5,
  "eventType": "restock",
  "reason": "午後補充"
}
```

`eventType` は `restock`、`discard`、`adjust` のいずれかです。現在在庫は `MAX(0, current_stock + quantityDelta)` で更新されます。販売・取消は会計処理の中で `sale`、`presale_pickup`、`cancel` として記録されます。

## 6. データベース仕様

### 6.1 `products`

商品マスタです。

| カラム | 型 | 内容 |
| --- | --- | --- |
| `id` | TEXT PK | 商品 ID |
| `name` | TEXT | 内部名 |
| `display_name` | TEXT | 表示名 |
| `category` | TEXT | おにぎり / サイドメニュー / 飲み物等 |
| `price` | INTEGER | 円単位、0 以上 |
| `initial_stock` | INTEGER | 初期在庫、0 以上 |
| `is_public` | INTEGER | 公開対象フラグ |
| `is_active` | INTEGER | レジ販売対象フラグ |
| `sort_order` | INTEGER | 表示順 |
| `allergy_text` | TEXT | アレルギー表示 |
| `description` | TEXT | 商品説明 |
| `note` | TEXT | 注記 |
| `created_at` / `updated_at` | TEXT | ISO 時刻 |

### 6.2 `product_inventory`

商品ごとの現在在庫を保持します。

- `product_id` が商品 ID と 1 対 1
- `current_stock` は 0 以上
- `updated_at` に在庫更新時刻を保持する

### 6.3 `sales`

会計ヘッダです。

- `idempotency_key` は UNIQUE
- `sale_type`: `normal` または `presale_pickup`
- `payment_method`: `cash` または `prepaid`（新規の前売りは `cash`）
- `status`: `completed` または `canceled`
- `total_amount`、`paid_amount`、`change_amount` は円単位
- `created_by_role`: `staff`、`admin`、`owner`
- 取消時は `canceled_at` を設定する

### 6.4 `sale_items`

販売ごとの商品明細です。

- `quantity` は正の整数
- `unit_price` と `subtotal` は販売時点の価格を保存する
- 商品価格が後日変更されても過去の明細金額は変わらない

### 6.5 `stock_events`

在庫変動の監査履歴です。

`event_type` は次のいずれかです。

`initial`、`sale`、`presale_pickup`、`cancel`、`restock`、`discard`、`adjust`

販売に紐づくイベントは `related_sale_id` を持ち、手動イベントは `reason` を持ちます。

### 6.6 `settings`

キー・バリュー形式の運用設定です。主なキーは次のとおりです。

- `shop_name`
- `public_status_enabled`
- `sales_open`
- `sales_day`（`all` / `day1` / `day2`）
- `timezone`
- `threshold_low` / `threshold_mid` / `threshold_high`
- `staff_username`
- `admin_username`
- `owner_username`
- `pickup_1_username` 〜 `pickup_4_username`

パスワードハッシュは Cloudflare Secrets で管理し、このテーブルの編集対象には含めません。

### 6.7 `login_attempts`

ログイン試行制限用です。

- 主キーは、ロールまたはログイン対象と送信元 IP を組み合わせた `throttle_key`
- `failed_count` に失敗回数を保存する
- 5 回目の失敗から 15 分間ロックする
- 正常ログイン時に該当レコードを削除する

## 7. マイグレーション

| ファイル | 役割 |
| --- | --- |
| `0001_initial.sql` | 基本テーブル、制約、インデックスの作成 |
| `0002_seed_example.sql` | 既存スキーマを保持したまま、例示商品・設定を投入 |
| `0003_login_attempts.sql` | ログイン試行制限テーブル追加 |
| `0004_public_menu_refresh.sql` | 商品カテゴリ追加、公開用メニューを投入 |
| `0005_allow_staff_sale_records.sql` | 販売・在庫イベントの作成者に `staff` を許可 |

`0002_seed_example.sql` は既存テーブルを削除せず、例示データを `INSERT OR IGNORE` で投入します。すでに旧版の `0002` を適用した環境では、ファイルを変更しても適用済みのSQLは再実行されないため、migration履歴を確認してください。

## 8. Cloudflare 運用仕様

`wrangler.jsonc` を Cloudflare 設定の正とします。

- Pages プロジェクト名: `gakuyusai`
- ビルド出力: `dist`
- D1 バインディング: `DB`
- 本番環境と `preview` 環境にそれぞれ D1 を設定
- preview では `PREVIEW_AUTH_BYPASS=true` を設定
- 本番パスワードハッシュとセッション秘密鍵は Cloudflare Secrets で管理する

主要コマンド:

```bash
npm run dev
npm run build
npm run typecheck
npm run test
npm run db:migrate:local
npm run cf:deploy
```

`.env`、`.dev.vars`、Cloudflare API Token、秘密鍵、実際の売上 CSV は Git にコミットしません。

## 9. エラーと整合性

- API は認証不備を HTTP 401 で返す
- 権限不足も現行実装では HTTP 401 として扱う
- 二重会計は `idempotency_key` の UNIQUE 制約と再取得で防ぐ
- 在庫不足は事前確認と DB 更新を行い、エラー時は販売を完了させない
- 販売取消は一度だけ実行でき、二重取消は HTTP 409
- 取消時は販売状態を変更し、販売数量分を在庫へ戻し、取消イベントを追加する
- CSV は UTF-8 BOM 付きで出力する。売上・在庫イベント CSV は値にカンマ、改行、引用符がある場合に CSV エスケープする

## 10. テスト仕様

現行の単体テストには次の領域があります。

- `money.test.ts`: 円金額の表示・計算
- `stockLevel.test.ts`: 在庫段階としきい値
- `auth.test.ts`: セッション・パスワード関連
- `loginThrottle.test.ts`: ログイン試行制限
- `salePayment.test.ts`: 通常販売・事前販売の支払条件
- `register.test.tsx`: レジ画面の操作

標準確認コマンド:

```bash
npm run typecheck
npm run test
npm run build
```

## 11. 現行実装との差分・注意点

今後の保守で特に確認すべき事項です。

1. `plan.md` ではスタッフの在庫操作や CSV 出力を広く想定していますが、現行 API の在庫・履歴・CSV は `admin` / `owner` のみです。`staff` はレジ利用に限定されています。
2. `plan.md` のロール説明では `admin` が販売履歴・在庫を担当し、`owner` が商品・公開設定を担当する構成ですが、画面 URL は複数とも同一 `AdminPage` に集約されています。最終的な制御は API のロールチェックが担います。
3. `sales_open` は会計APIで確認され、販売受付を停止できます。`sales_day` は `all`（制限なし）、`day1`（前売り券のみ）、`day2`（通常販売のみ）を選択でき、会計API側でも販売種別を検証します。
4. `POST /api/admin/products` は新規商品作成時に在庫レコードを作成しますが、既存商品更新時は現在在庫を初期在庫へ戻さず、在庫更新時刻だけを更新します。初期在庫変更の意味を運用ルールとして明確化する必要があります。
5. 公開 API は `public_status_enabled=false` でも商品データを返し、UI が「公開停止中」と表示する方式です。完全に非公開にする要件なら、停止時のレスポンス設計を見直します。
6. `0002_seed_example.sql` は DROP/CREATE を含むため、本番 DB に適用する場合は破壊的変更として扱います。
7. `wrangler.jsonc` に D1 の database ID が含まれているため、公開リポジトリへ出す場合は、リポジトリ公開方針と Cloudflare の権限・データ公開範囲を再確認します。

## 12. 受入条件

次を満たせば、文化祭当日の基本運用に必要な機能が揃ったと判断します。

- 一般客が `/` で商品と段階在庫を確認できる
- staff がログインして会計できる
- 通常販売の支払不足、在庫不足、二重送信が適切に拒否される
- 前売りを1日目に現金販売し、6文字のIDで2日目に検索・受取済み記録できる
- admin / owner が在庫を補充・廃棄・補正できる
- admin / owner が販売履歴、集計、CSV を確認できる
- owner が商品、公開設定、しきい値、アカウント設定を変更できる
- 取消時に在庫が戻り、監査イベントが残る
- TypeScript の型チェック、単体テスト、ビルドが成功する
