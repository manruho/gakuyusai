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

Cloudflare Pages / D1 の設定は `wrangler.jsonc`、受取画面のリアルタイム通知に使う Durable Object Worker の設定は `wrangler.realtime.jsonc` を正とします。

```bash
npm exec wrangler whoami
npm exec wrangler pages project list
npm run db:migrations:list:remote
npm run cf:secrets:list
```

本番用 Pages Secret には次の値が必要です。

- `STAFF_USERNAME`
- `STAFF_PASSWORD_HASH`
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD_HASH`
- `OWNER_USERNAME`
- `OWNER_PASSWORD_HASH`
- `PICKUP_1_USERNAME` 〜 `PICKUP_4_USERNAME`
- `PICKUP_1_PASSWORD_HASH` 〜 `PICKUP_4_PASSWORD_HASH`
- `SESSION_SECRET`

不足する Secret は値をコマンドライン引数に含めず、対話入力で登録します。

```bash
npm exec wrangler pages secret put SECRET_NAME --project-name gakuyusai
```

### デプロイ前検証

```bash
npm ci
npm run cf:preflight
```

`cf:preflight` は型検査、lint、単体テスト、フロントエンドビルド、Pages Functions のビルド、Realtime Worker の strict dry-run を順番に実行します。Cloudflare 上のリソースは変更しません。

### 本番デプロイ

未適用 migration の SQL を確認し、破壊的変更がないことを確認してから実行します。

```bash
npm run db:migrations:list:remote
npm run cf:deploy
```

`cf:deploy` は preflight の完了後、D1 migration、`gakuyusai-realtime` Worker、`main` ブランチの Pages デプロイの順に反映します。Pages の `REALTIME_HUB` は別 Worker を参照するため、この順序を変更しないでください。

### 初期ログイン情報

本番の初期ログインは Cloudflare Pages Secret で管理します。平文パスワードは受け付けないため、`*_PASSWORD_HASH` にはアプリの PBKDF2 形式のハッシュを登録してください。

- `staff` -> `/staff/register`
- `admin` -> `/staff/register`
- `owner` -> `/admin`

`staff` はレジ、`admin` は販売履歴・在庫・CSV、`owner` はそれらに加えて商品・公開設定を管理します。受取窓口 1〜4 を含むユーザー名は `/admin`、パスワードハッシュは `PICKUP_1_PASSWORD_HASH` 〜 `PICKUP_4_PASSWORD_HASH` などの Cloudflare Pages Secret で設定します。

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
