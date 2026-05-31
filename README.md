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

## 画面

- `/` 公開ページ
- `/login` スタッフログイン
- `/staff/register` レジ
- `/staff/stock` 在庫管理
- `/admin` 管理画面

## API

- `GET /api/public/status`
- `POST /api/auth/login`

