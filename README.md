# gakuyusai

文化祭食品販売システムです。Cloudflare Pages + Pages Functions + D1 + React + TypeScript で構成しています。

## 開発

```bash
npm install
npm run dev
```

## ビルド

```bash
npm run build
```

## テスト

```bash
npm run typecheck
npm run test
```

## Cloudflare

`wrangler.jsonc` に D1 の `database_id` を設定しています。公開前に実際の環境へ合わせてください。

```bash
npm run db:migrate:local
npm run cf:deploy
```

### 初期ログイン情報

本番の初期ログインは Cloudflare Pages Secret と D1 `settings` の両方で管理します。

- `staff` -> `/staff/register`
- `admin` -> `/staff/register`
- `owner` -> `/admin`

初期パスワードはランダム生成済みです。運用時は必要に応じて管理画面 `/admin` から変更してください。

現在の初期値:

- `staff` / `admin` / `owner` の3系統を利用
- `staff` と `admin` はレジ用
- `owner` は管理用

Cloudflare へ反映する場合は、`pages secret put` と `wrangler d1 execute --remote` で `ADMIN_USERNAME` / `ADMIN_PASSWORD_HASH` / `OWNER_USERNAME` / `OWNER_PASSWORD_HASH` / `SESSION_SECRET` を更新してください。

## 画面

- `/` 公開ページ
- `/login` スタッフログイン
- `/staff/register` レジ
- `/staff/register/select` レジ番号選択
- `/staff/register/recent-sales` レジ別の最近の会計
- `/staff/stock` 在庫管理
- `/pickup` 受取窓口
- `/admin` 管理画面

## API

- `GET /api/public/status`
- `POST /api/auth/login`
- `GET /api/pickup/orders`
- `POST /api/pickup/orders/:orderId/deliver`
- `POST /api/pickup/orders/:orderId/restore`
- `POST /api/pickup/orders/:orderId/ack-cancel`
- `GET /api/pickup/live`（WebSocket。切断時は60秒ごとのD1同期で復元）

受取連携の詳細仕様は [oder_spec.md](./oder_spec.md)、プロジェクト全体の仕様は [SPECIFICATION.md](./SPECIFICATION.md) を参照してください。
