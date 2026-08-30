# Codex 実装指示書
# Project: gakuyusai
# 文化祭食品販売システム

## 0. あなたの役割

あなたは、このリポジトリ `gakuyusai` の実装担当エージェントです。

目的は、文化祭の食品販売に使う軽量Webアプリケーションを、Cloudflare Pages + Pages Functions + D1 + React + TypeScript で実装し、Cloudflare上で実際に運用可能な状態まで整えることです。

この指示書に従って、リポジトリの初期化、依存関係の導入、Cloudflare Pagesプロジェクト作成、D1データベース作成、migration作成、実装、テスト、README整備、デプロイ準備まで行ってください。

---

## 0.1 現行の設計方針

- `staff` はレジ専用。ログイン後は `/staff/register` に入る。
- `admin` は運用担当。販売履歴、在庫確認、CSV 出力を担当する。
- `owner` は管理担当。`admin` の機能に加えて、商品マスタと公開設定を変更する。
- 在庫確認とレジは分離する。スタッフのレジ画面と在庫管理画面は別 URL にする。
- Cloudflare の設定は `wrangler.jsonc` を正とする。

---

## 1. 最重要プロジェクト情報

### 1.1 GitHub

作業対象リポジトリ:

```bash
git@github.com:manruho/gakuyusai.git
````

作業開始時に以下を実行してください。

```bash
git clone git@github.com:manruho/gakuyusai.git
cd gakuyusai
```

すでにローカルに存在する場合は、既存ディレクトリを使ってください。

### 1.2 Cloudflare Pages

新しくCloudflare Pagesプロジェクトを作成してください。

```text
Cloudflare Pages project name: gakuyusai
Production branch: main
```

作成コマンドの基本形:

```bash
npx wrangler pages project create gakuyusai --production-branch main
```

すでに `gakuyusai` というPagesプロジェクトが存在する場合は、新規作成し直さず、既存プロジェクトを利用してください。

### 1.3 Cloudflare D1

新しくCloudflare D1データベースを作成してください。

```text
D1 database name: gakuyusai
D1 binding name: DB
```

作成コマンドの基本形:

```bash
npx wrangler d1 create gakuyusai
```

D1作成後に表示される `database_id` を `wrangler.jsonc` に反映してください。

### 1.4 Cloudflare設定ファイル

`wrangler.toml` ではなく、原則として `wrangler.jsonc` を使ってください。

必須設定:

```jsonc
{
  "name": "gakuyusai",
  "compatibility_date": "2026-05-30",
  "pages_build_output_dir": "dist",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "gakuyusai",
      "database_id": "replace-with-created-d1-database-id"
    }
  ]
}
```

`database_id` は実際に `npx wrangler d1 create gakuyusai` で作成した値に置き換えてください。

### 1.5 URL 構成

- `/login` - ログイン
- `/staff/register` - スタッフ用レジ
- `/staff/stock` - 在庫確認
- `/admin` - 管理トップ
- `/admin/sales` - 販売履歴
- `/admin/inventory` - 在庫運用
- `/admin/products` - 商品マスタ
- `/admin/settings` - 公開設定とアカウント設定

`staff` は `/staff/register` を最優先の導線として扱い、`admin` / `owner` は `/admin/*` に集約する。

---

## 2. 許可されている操作

あなたは以下の操作を実行してよいです。

### 2.1 ローカル操作

許可:

```bash
npm install
npm run build
npm run test
npm run lint
npm run typecheck
npm run test:e2e
git status
git diff
git add
git commit
```

許可されるファイル編集:

```text
README.md
package.json
package-lock.json
vite.config.ts
tsconfig.json
wrangler.jsonc
migrations/*.sql
src/**
functions/**
worker/**
tests/**
public/**
.env.example
.dev.vars.example
.gitignore
AGENTS.md
```

### 2.2 Cloudflare操作

以下は実行してよいです。

```bash
npx wrangler login
npx wrangler whoami
npx wrangler pages project create gakuyusai --production-branch main
npx wrangler d1 create gakuyusai
npx wrangler d1 migrations create gakuyusai initial
npx wrangler d1 migrations apply gakuyusai --local
npx wrangler pages deploy dist --project-name gakuyusai
```

ただし、以下は実行前に必ず現在の状態を確認してください。

```bash
npx wrangler pages project list
npx wrangler d1 list
```

すでに同名のPagesプロジェクトまたはD1データベースが存在する場合は、重複作成せず既存のものを使ってください。

### 2.3 本番D1 migration

次は、ローカルテストとビルドが成功した後にのみ実行してよいです。

```bash
npx wrangler d1 migrations apply gakuyusai --remote
```

実行前に、適用されるSQLファイル名と内容を確認し、破壊的変更がないことを確認してください。

---

## 3. 禁止事項

以下は禁止です。

### 3.1 Git操作

禁止:

```bash
git push --force
git reset --hard origin/main
git clean -fdx
git branch -D main
```

`main` への直接pushは避けてください。可能なら作業ブランチを切ってください。

推奨ブランチ:

```bash
git checkout -b feature/initial-gakuyusai
```

### 3.2 Cloudflare破壊操作

禁止:

```bash
npx wrangler d1 delete
npx wrangler pages project delete
```

Cloudflare上のプロジェクト、D1データベース、Secretを削除しないでください。

### 3.3 Secretの扱い

以下をGitに保存してはいけません。

```text
ADMIN_PASSWORD_HASH
OWNER_PASSWORD_HASH
SESSION_SECRET
Cloudflare API Token
Cloudflare Account ID
本番D1 database_id を含む非公開設定
実際の売上CSV
```

ただし、`wrangler.jsonc` にD1の `database_id` が必要な場合は、Cloudflare運用上必要な設定として保存してよいです。公開リポジトリにする場合は、READMEで注意書きをしてください。

`.env` や `.dev.vars` はGit管理しないでください。

`.env.example` と `.dev.vars.example` のみGit管理してください。

---

## 4. 実装するシステム概要

本システムは、文化祭の食品販売における以下を一体化したWebアプリケーションです。

* 在庫管理
* 現金レジ
* 事前販売分の受け渡し記録
* 一般客向け在庫状況公開
* CSV出力
* 当日運用マニュアル

一般客はQRコードから公開ページを開き、各商品の在庫状況を4段階で確認します。
スタッフのログインするURLと公開ページは別にして、スタッフのログインするページは、とんたらログインフォームがあり、ここでログインすることで、一般スタッフはレジ、Ownerやadminは管理画面とかが見れるようにしてほしいです。
スタッフはPCからログインし、レジ操作、在庫確認、補充、廃棄、棚卸し補正、CSV出力を行います。

OSSとして公開し、翌年以降の後輩や別クラスが、商品名、価格、初期在庫、アレルギー情報を変更するだけで再利用できることを目指します。

---

## 5. 技術スタック

必須技術:

```text
Frontend: React
Build: Vite
Language: TypeScript
Routing: React Router
API: Cloudflare Pages Functions
API Router: Hono
Validation: Zod
Database: Cloudflare D1
Auth: HttpOnly Cookie + 署名セッション
Unit Test: Vitest
E2E Test: Playwright
Deploy: Cloudflare Pages
CLI: Wrangler
Package manager: npm
```

採用しないもの:

```text
Google Sheets as DB
Firebase
localStorage only DB
JSON file DB
重いORM
電子決済
個人アカウント
予約注文
完全オフライン同期
```

---

## 6. 初期セットアップ手順

作業開始時に以下を実行してください。

### 6.1 Repository

```bash
git clone git@github.com:manruho/gakuyusai.git
cd gakuyusai
git checkout -b feature/initial-gakuyusai
```

すでにclone済みなら、cloneは不要です。

### 6.2 Node / npm確認

```bash
node -v
npm -v
```

Node.jsが未導入の場合は作業を止め、導入が必要であることを報告してください。

### 6.3 package 初期化

リポジトリが空に近い場合は、Vite + React + TypeScript構成を作成してください。

```bash
npm create vite@latest . -- --template react-ts
```

すでにVite構成がある場合は、既存構成を壊さず利用してください。

### 6.4 依存関係

必須依存関係:

```bash
npm install react-router-dom hono zod
npm install -D wrangler vitest playwright @playwright/test typescript vite eslint prettier
```

必要なら以下も追加してください。

```bash
npm install clsx
npm install -D @types/node jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

---

## 7. package.json scripts

`package.json` に以下のscriptsを用意してください。

```json
{
  "scripts": {
    "dev": "vite --host 0.0.0.0",
    "build": "vite build",
    "preview": "vite preview",
    "cf:dev": "wrangler pages dev dist",
    "cf:deploy": "npm run build && wrangler pages deploy dist --project-name gakuyusai",
    "db:create": "wrangler d1 create gakuyusai",
    "db:migration:create": "wrangler d1 migrations create gakuyusai",
    "db:migrate:local": "wrangler d1 migrations apply gakuyusai --local",
    "db:migrate:remote": "wrangler d1 migrations apply gakuyusai --remote",
    "db:list": "wrangler d1 list",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest",
    "test:e2e": "playwright test",
    "lint": "eslint ."
  }
}
```

必要に応じて実際の構成に合わせて調整してよいです。

---

## 8. ディレクトリ構成

最終的に以下のような構成にしてください。

```text
gakuyusai/
  README.md
  LICENSE
  AGENTS.md
  package.json
  package-lock.json
  wrangler.jsonc
  .gitignore
  .env.example
  .dev.vars.example
  migrations/
    0001_initial.sql
    0002_seed_example.sql
  public/
  src/
    main.tsx
    app/
      App.tsx
      routes/
        PublicPage.tsx
        LoginPage.tsx
        RegisterPage.tsx
        StockPage.tsx
        AdminPage.tsx
    components/
      ProductCard.tsx
      StockLevelBar.tsx
      AllergyModal.tsx
      CartPanel.tsx
      ConfirmCheckout.tsx
      CompleteCheckout.tsx
      ErrorMessage.tsx
      LoadingView.tsx
    features/
      public-status/
      register/
      stock/
      admin/
      auth/
    lib/
      apiClient.ts
      money.ts
      stockLevel.ts
      date.ts
      ids.ts
      types.ts
  functions/
    api/
      [[route]].ts
  worker/
    app.ts
    routes/
      public.ts
      auth.ts
      sales.ts
      stock.ts
      admin.ts
    services/
      saleService.ts
      stockService.ts
      authService.ts
      csvService.ts
    db/
      schema.ts
      queries.ts
    utils/
      session.ts
      password.ts
      response.ts
      time.ts
  tests/
    unit/
      stockLevel.test.ts
      money.test.ts
      auth.test.ts
    api/
      publicStatus.test.ts
      sales.test.ts
      stock.test.ts
    e2e/
      register.spec.ts
      public.spec.ts
```

---

## 9. コーディング規約

### 9.1 TypeScript

必ずTypeScriptで実装してください。

方針:

* `any` は原則禁止
* 型エイリアスまたはinterfaceを明示する
* APIレスポンス型を定義する
* Zod schemaから型を推論して使う
* 関数は責務ごとに分割する
* UI、API client、service、DB queryを分離する

### 9.2 コメント

コメントは日本語で書いてください。

ただし、コメントを増やしすぎないでください。

コメントは「なぜそうしているか」を説明するために使ってください。

例:

```ts
// 在庫数は公開ページに返さない。混雑や買い占めを誘発しないため。
```

### 9.3 TSDoc

重要な関数には日本語TSDocを書いてください。

```ts
/**
 * 在庫率から公開ページ用の4段階ステータスを計算する。
 *
 * 正確な在庫数は一般客に返さず、段階表示だけを返す。
 */
export function getStockLevel(currentStock: number, initialStock: number): StockLevel {
  ...
}
```

### 9.4 テスト

単体テストでは「何を保証しているか」が分かるテスト名にしてください。

```ts
it("在庫が0以下の場合は売り切れとして扱う", () => {
  ...
});
```

---

## 10. 環境変数

### 10.1 本番Secret

Cloudflare PagesのSecretとして登録するもの:

```text
ADMIN_USERNAME
ADMIN_PASSWORD_HASH
OWNER_USERNAME
OWNER_PASSWORD_HASH
SESSION_SECRET
PUBLIC_SHOP_NAME
```

Secret登録コマンド例:

```bash
npx wrangler pages secret put ADMIN_USERNAME --project-name gakuyusai
npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name gakuyusai
npx wrangler pages secret put OWNER_USERNAME --project-name gakuyusai
npx wrangler pages secret put OWNER_PASSWORD_HASH --project-name gakuyusai
npx wrangler pages secret put SESSION_SECRET --project-name gakuyusai
npx wrangler pages secret put PUBLIC_SHOP_NAME --project-name gakuyusai
```

値そのものはCodexに要求しないでください。

### 10.2 .dev.vars.example

`.dev.vars.example` を作成してください。

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=replace_with_hash
OWNER_USERNAME=owner
OWNER_PASSWORD_HASH=replace_with_hash
SESSION_SECRET=replace_with_random_secret
PUBLIC_SHOP_NAME=文化祭食品販売
```

### 10.3 .env.example

`.env.example` も作成してください。

```text
ADMIN_USERNAME=admin
ADMIN_PASSWORD_HASH=replace_with_hash
OWNER_USERNAME=owner
OWNER_PASSWORD_HASH=replace_with_hash
SESSION_SECRET=replace_with_random_secret
PUBLIC_SHOP_NAME=文化祭食品販売
```

### 10.4 Preview 専用レジ認証バイパス

Cloudflare Pages の Preview 環境では、レジ確認用として `PREVIEW_AUTH_BYPASS=true` を設定してよい。

認証バイパスは次の条件をすべて満たす場合だけ `staff` ロールとして有効にする。

* `PREVIEW_AUTH_BYPASS` が `true`
* `CF_PAGES_BRANCH` が存在する
* `CF_PAGES_BRANCH` が `main` ではない

管理者・所有者権限は付与しない。本番環境と `main` ブランチでは、設定ミスがあっても認証バイパスを有効にしない。

---

## 11. 認証仕様

### 11.1 認証方式

個人ごとのアカウントではなく、ロールごとの共通Username + Passwordを使います。

ロール:

```text
staff
pickup
admin
owner
```

### 11.2 保存するSecret

```text
STAFF_USERNAME
STAFF_PASSWORD_HASH
ADMIN_USERNAME
ADMIN_PASSWORD_HASH
OWNER_USERNAME
OWNER_PASSWORD_HASH
PICKUP_1_USERNAME ... PICKUP_4_USERNAME
PICKUP_1_PASSWORD_HASH ... PICKUP_4_PASSWORD_HASH
SESSION_SECRET
```

平文パスワードは保存しないでください。
パスワードハッシュと `SESSION_SECRET` は Cloudflare Secrets を正とし、ブラウザへ返したり管理 API から更新したりしないでください。D1 に残る既存ハッシュは移行互換用のフォールバックに限ります。

### 11.3 パスワードハッシュ

PBKDF2-SHA256など、Cloudflare Workers環境でも検証可能な方式を使ってください。

ハッシュ形式の例:

```text
pbkdf2_sha256$100000$salt$hash
```

必要なら `scripts/hash-password.ts` を追加し、ローカルでパスワードハッシュを生成できるようにしてください。

例:

```bash
npm run auth:hash-password
```

### 11.4 セッション

ログイン成功時、署名付きHttpOnly Cookieを発行してください。

Cookie設定:

```text
HttpOnly: true
Secure: true in production
SameSite: Lax
Path: /
Max-Age: 12 hours
```

セッションpayload:

```ts
type SessionPayload = {
  role: "admin" | "owner";
  username: string;
  exp: number;
};
```

HMAC-SHA256で署名してください。

### 11.5 権限

権限階層:

```text
public < admin < owner
```

adminができること:

* レジ利用
* 通常販売記録
* 事前販売受け渡し記録
* 在庫確認
* 補充
* 廃棄
* 棚卸し補正
* 販売履歴確認
* CSV出力

ownerができること:

* adminの全権限
* 商品作成
* 商品編集
* 価格変更
* 初期在庫変更
* アレルギー情報変更
* 公開ページON/OFF
* 4段階しきい値変更
* ログイン情報変更
* システム設定変更

---

## 12. 画面仕様

## 12.1 公開ページ `/`

認証不要です。

表示:

* 店名
* 最終更新時刻
* 商品カード一覧
* 商品名
* 価格
* 4段階在庫ステータス
* 売り切れ表示
* アレルギーポップアップ

一般客には正確な在庫数を表示しないでください。

在庫表示は以下の4段階です。

```text
あとちょっとだよ
まだすこしのこってるよ
けっこうのこってるよ
まだまだあるよ
```

在庫0の場合は、4段階表示とは別に「売り切れ」と表示してください。

更新仕様:

* 初回表示時に `/api/public/status` を取得
* 2〜3分ごとに再取得
* API失敗時は最後に取得できた情報を表示し続ける
* 最終更新時刻を表示する

API失敗時の文言:

```text
最新情報を取得できませんでした。
表示は前回更新時点のものです。
```

## 12.2 ログイン画面 `/login`

入力:

* Username
* Password

ログイン成功時:

```text
admin -> /staff/register
owner -> /admin
```

ログイン失敗時:

```text
ユーザー名またはパスワードが違います。
```

## 12.3 レジ画面 `/staff/register`

目的は、レジ操作ミスを減らすことです。

重要:

* 商品選択中はAPIに書き込まない
* APIに書き込むのは最終確認画面で「お会計確定」を押したときだけ
* 二重送信を防ぐ
* 在庫不足時は完了画面に進ませない

画面遷移:

```text
商品選択画面
  ↓ 確認へ進む
会計確認画面
  ↓ お会計確定
会計完了画面
```

商品選択画面:

* 通常販売 / 事前販売モード切替
* レジ1〜3は通常販売専用、レジ4は前売り販売専用
* 商品ボタン一覧
* カート
* 合計金額
* 預かり金額
* おつり
* カートを空にする
* 確認へ進む
* 在庫を再読み込み

PC表示では商品欄を広く、カートを右側に固定幅で表示する。商品カード右側の数量操作は上から「＋」「−」の順にする。「選択を空にする」と「在庫を再読み込み」は、主操作より小さい補助操作として各領域の下部に置く。

販売モードは画面上部のコンパクトな1行バーで切り替える。大きなヘッダーや説明文で縦幅を使わず、「事前販売」の表示も補助ラベル相当の小さな文字にする。

レジ画面は文化祭らしい温かさを持たせつつ、色の意味が分かる構成にする。

* 藍色: テンキーと基本操作
* 朱色: おにぎりカテゴリ、会計へ進む主操作
* 緑: サイドカテゴリ、おつり、完了
* 黄土色: 飲み物カテゴリと補助的なアクセント
* 紫: 事前販売モード
* 深い赤: 預かり不足、通信失敗、危険操作
* 生成りと白: 画面背景と操作面

文字を大きくするのは会計合計と「あと○円／おつり○円」に限定する。商品や会計情報をすべて影付きカードにせず、罫線、色帯、余白、背景色で区切るフラットな構成を基本とする。キーボードフォーカスは明確に表示する。

ポップさは薄い紙吹雪ドット、小さな多色アクセント、操作部の軽い丸み程度に留め、文字を大きくしたりカードを増やしたりしない。

商品ボタン状態:

```text
在庫あり: 押せる
在庫少なめ: 押せる、小さく「残り少なめ」
在庫なし: 押せない、「売り切れ」
販売停止: 押せない、「停止中」
```

会計確認画面:

PC表示では「今回のお会計」を左側で最も大きく表示し、その隣に受け取った金額、その下に「あと○円を受け取ってください」または「おつり○円をお返しください」を表示する。預かり金額入力とテンキーは右側に分ける。「不足」という見出しは表示しない。商品明細は折りたたみ可能な補助情報として扱う。

```text
これでお会計を確定していいですか？

焼きそば × 2   600円
ドリンク × 1   150円

合計        750円
預かり     1000円
おつり      250円

[戻って修正] [お会計確定]
```

会計完了画面:

```text
会計が完了しました

合計        750円
預かり     1000円
おつり      250円

[次の会計へ]
[この会計を取り消す]
```

確定失敗時:

```text
会計を確定できませんでした。
在庫が不足しているか、通信に失敗しました。

[商品選択に戻る]
[もう一度試す]
```

## 12.4 事前販売モード

事前販売された商品を、当日の受け渡し数として記録します。

通常販売との違い:

```text
通常販売:
  sale_type = normal
  payment_method = cash
  現金受け取りあり
  当日売上として集計
  在庫は減る

事前販売:
  sale_type = presale_pickup
  payment_method = cash
  前日に現金受け取り
  事前販売枠として別集計
  在庫は減る
  6文字の専用IDを発行し、翌日の前売り券専用PCで検索・受取済み記録を行う
  発行後は前売り券専用PCの予約一覧に表示し、受取済み操作は日本時間の受取日以降だけ許可する
  前売りIDは全期間で再利用せず、キャンセル不可
  販売操作はレジ4に限定する
```

確認画面の文言:

```text
この内容で前売り券を発行しますか？
```

確定ボタン:

```text
前売り券を発行
```

## 12.5 在庫画面 `/staff/stock`

表示:

* 商品別現在在庫
* 在庫ステータス
* 補充ボタン
* 廃棄ボタン
* 棚卸し補正ボタン
* 在庫イベント履歴

管理画面の `/admin/inventory` では、全商品の初期在庫、現在庫、販売済み数、残り割合を一つの一覧で表示する。カテゴリで絞り込みでき、残り20%以下と売り切れは色で強調する。在庫一覧から補充、廃棄、棚卸し補正を実行できる。

すべて確認画面を挟んでください。

例:

```text
焼きそばを20個補充しますか？

[戻る] [補充を確定]
```

## 12.6 管理画面 `/admin`

owner向けです。

機能:

* 商品一覧
* 商品追加
* 商品編集
* 価格変更
* 初期在庫変更
* アレルギー情報変更
* 公開ページON/OFF
* ステータスしきい値設定
* admin/ownerログイン情報変更
* CSV出力

---

## 13. 在庫ステータス仕様

### 13.1 判定式

```text
在庫率 = current_stock / initial_stock
```

### 13.2 表示

```text
current_stock <= 0:
  売り切れ

在庫率 <= 0.15:
  あとちょっとだよ

在庫率 <= 0.35:
  まだすこしのこってるよ

在庫率 <= 0.65:
  けっこうのこってるよ

在庫率 > 0.65:
  まだまだあるよ
```

### 13.3 実装場所

```text
src/lib/stockLevel.ts
```

単体テスト:

```text
tests/unit/stockLevel.test.ts
```

必ずテストしてください。

---

## 14. データベース設計

D1 migrationとして `migrations/0001_initial.sql` を作成してください。

### 14.1 products

```sql
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  display_name TEXT NOT NULL,
  price INTEGER NOT NULL CHECK (price >= 0),
  initial_stock INTEGER NOT NULL CHECK (initial_stock >= 0),
  is_public INTEGER NOT NULL DEFAULT 1,
  is_active INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  allergy_text TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 14.2 product_inventory

```sql
CREATE TABLE IF NOT EXISTS product_inventory (
  product_id TEXT PRIMARY KEY,
  current_stock INTEGER NOT NULL DEFAULT 0 CHECK (current_stock >= 0),
  updated_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

重要:

`current_stock >= 0` のCHECK制約を必ず置いてください。

### 14.3 sales

```sql
CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT NOT NULL UNIQUE,
  sale_type TEXT NOT NULL CHECK (sale_type IN ('normal', 'presale_pickup')),
  total_amount INTEGER NOT NULL CHECK (total_amount >= 0),
  paid_amount INTEGER NOT NULL CHECK (paid_amount >= 0),
  change_amount INTEGER NOT NULL CHECK (change_amount >= 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('cash', 'prepaid')),
  status TEXT NOT NULL CHECK (status IN ('completed', 'canceled')),
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'owner')),
  created_at TEXT NOT NULL,
  canceled_at TEXT
);
```

### 14.4 sale_items

```sql
CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price INTEGER NOT NULL CHECK (unit_price >= 0),
  subtotal INTEGER NOT NULL CHECK (subtotal >= 0),
  FOREIGN KEY (sale_id) REFERENCES sales(id),
  FOREIGN KEY (product_id) REFERENCES products(id)
);
```

### 14.5 stock_events

```sql
CREATE TABLE IF NOT EXISTS stock_events (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN ('initial', 'sale', 'presale_pickup', 'cancel', 'restock', 'discard', 'adjust')
  ),
  quantity_delta INTEGER NOT NULL,
  related_sale_id TEXT,
  reason TEXT NOT NULL DEFAULT '',
  created_by_role TEXT NOT NULL CHECK (created_by_role IN ('admin', 'owner')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (product_id) REFERENCES products(id),
  FOREIGN KEY (related_sale_id) REFERENCES sales(id)
);
```

### 14.6 settings

```sql
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

設定例:

```text
shop_name
public_status_enabled
sales_open
stock_level_thresholds
timezone
```

### 14.7 indexes

```sql
CREATE INDEX IF NOT EXISTS idx_products_sort_order ON products(sort_order);
CREATE INDEX IF NOT EXISTS idx_sales_created_at ON sales(created_at);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale_id ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_stock_events_product_id ON stock_events(product_id);
CREATE INDEX IF NOT EXISTS idx_stock_events_created_at ON stock_events(created_at);
```

---

## 15. seedデータ

`migrations/0002_seed_example.sql` を作成してください。

サンプル商品を入れてください。

例:

```sql
INSERT INTO products (
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

INSERT INTO product_inventory (
  product_id, current_stock, updated_at
) VALUES
('yakisoba', 100, datetime('now')),
('drink', 120, datetime('now'));

INSERT INTO settings (
  key, value, updated_at
) VALUES
('shop_name', '文化祭食品販売', datetime('now')),
('public_status_enabled', 'true', datetime('now')),
('sales_open', 'true', datetime('now')),
('timezone', 'Asia/Tokyo', datetime('now'));
```

---

## 16. API仕様

APIはHonoで実装してください。

エントリーポイント:

```text
functions/api/[[route]].ts
worker/app.ts
```

`functions/api/[[route]].ts` から `worker/app.ts` のHono appを呼び出す構成にしてください。

### 16.1 共通レスポンス

成功:

```json
{
  "ok": true,
  "data": {}
}
```

失敗:

```json
{
  "ok": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "表示用メッセージ"
  }
}
```

### 16.2 GET `/api/public/status`

認証不要。

返してよい情報:

* 商品名
* 価格
* 4段階ステータス
* 売り切れ状態
* アレルギー情報
* 注意事項

返してはいけない情報:

* 正確な現在在庫
* 売上
* 販売履歴
* 管理設定
* ログイン情報

レスポンス例:

```json
{
  "ok": true,
  "data": {
    "shopName": "文化祭食品販売",
    "updatedAt": "2026-09-20T10:30:00+09:00",
    "items": [
      {
        "id": "yakisoba",
        "displayName": "焼きそば",
        "price": 300,
        "statusLevel": 3,
        "statusText": "けっこうのこってるよ",
        "isSoldOut": false,
        "allergyText": "小麦、卵",
        "note": "同じ調理場で乳を含む商品を扱っています。"
      }
    ]
  }
}
```

推奨Cache-Control:

```http
Cache-Control: public, max-age=10, s-maxage=30
```

### 16.3 POST `/api/auth/login`

リクエスト:

```json
{
  "username": "admin",
  "password": "password"
}
```

レスポンス:

```json
{
  "ok": true,
  "data": {
    "role": "admin"
  }
}
```

成功時にHttpOnly Cookieを発行してください。

### 16.4 POST `/api/auth/logout`

ログアウトします。

Cookieを削除してください。

### 16.5 GET `/api/auth/me`

現在ログイン中のロールを返してください。

未ログインなら401を返してください。

### 16.6 GET `/api/register/products`

必要ロール:

```text
admin以上
```

レジ画面用の商品一覧と在庫状態を返してください。

スタッフ向けなので正確な在庫数を返してよいです。

### 16.7 POST `/api/sales`

販売確定APIです。

必要ロール:

```text
admin以上
```

通常販売リクエスト:

```json
{
  "idempotencyKey": "client-generated-uuid",
  "saleType": "normal",
  "paymentMethod": "cash",
  "paidAmount": 1000,
  "items": [
    {
      "productId": "yakisoba",
      "quantity": 2
    }
  ]
}
```

事前販売リクエスト:

```json
{
  "idempotencyKey": "client-generated-uuid",
  "saleType": "presale_pickup",
  "paymentMethod": "cash",
  "paidAmount": 1000,
  "items": [
    {
      "productId": "yakisoba",
      "quantity": 3
    }
  ]
}
```

重要:

* クライアントから送られた金額を信用しない
* 商品価格はD1から取得する
* 合計金額はサーバー側で再計算する
* おつりもサーバー側で再計算する
* 在庫不足なら409
* `idempotencyKey` の重複時は重複販売しない

### 16.8 POST `/api/sales/:saleId/cancel`

販売取消APIです。

必要ロール:

```text
admin以上
```

販売データは削除しないでください。

処理:

* `sales.status = canceled`
* `sales.canceled_at` を設定
* `product_inventory` を戻す
* `stock_events` に `cancel` を追加

### 16.9 GET `/api/stock`

必要ロール:

```text
admin以上
```

現在在庫一覧を返してください。

### 16.10 POST `/api/stock/events`

必要ロール:

```text
admin以上
```

補充・廃棄・棚卸し補正を行います。

リクエスト例:

```json
{
  "productId": "yakisoba",
  "eventType": "restock",
  "quantityDelta": 20,
  "reason": "追加調理分"
}
```

eventType:

```text
restock
discard
adjust
```

### 16.11 GET `/api/admin/summary`

必要ロール:

```text
admin以上
```

売上、在庫、販売数の集計を返してください。

### 16.12 POST `/api/admin/products`

必要ロール:

```text
owner
```

商品を作成してください。

### 16.13 PATCH `/api/admin/products/:productId`

必要ロール:

```text
owner
```

商品を更新してください。

### 16.14 GET `/api/admin/export/sales.csv`

必要ロール:

```text
admin以上
```

販売履歴CSVを返してください。

### 16.15 GET `/api/admin/export/stock-events.csv`

必要ロール:

```text
admin以上
```

在庫イベントCSVを返してください。

---

## 17. 販売確定処理の詳細

`worker/services/saleService.ts` に実装してください。

処理手順:

1. セッションを検証する
2. ロールがadmin以上か確認する
3. リクエストをZodで検証する
4. `idempotencyKey` の重複を確認する
5. 重複していた場合は既存saleを返す
6. 商品IDと個数を検証する
7. D1から商品価格、販売中状態、現在在庫を取得する
8. サーバー側で合計金額を再計算する
9. `paidAmount` が不足していないか確認する
10. saleをINSERTする
11. sale_itemsをINSERTする
12. product_inventoryを減算する
13. stock_eventsをINSERTする
14. 成功したら販売結果を返す
15. 在庫不足なら409 Conflictを返す

在庫減算:

```sql
UPDATE product_inventory
SET current_stock = current_stock - ?,
    updated_at = ?
WHERE product_id = ?;
```

`product_inventory.current_stock` に `CHECK (current_stock >= 0)` を置いているため、在庫不足時にはDB制約で失敗させてください。

ただし、D1の実際の実行仕様を確認し、複数SQLを安全に扱う方法を選んでください。もしD1で明示的なtransactionが使える構成にできるなら、販売確定処理はtransactionで実装してください。難しい場合は、失敗時に中途半端な更新が残らないように、更新順序とエラーハンドリングを慎重に実装し、テストで検証してください。

---

## 18. 二重送信対策

ブラウザ側:

* 確定ボタンを押したらdisabled
* ローディング表示
* 二度押しできないUI

サーバー側:

* `idempotencyKey` 必須
* `sales.idempotency_key` にUNIQUE制約
* 同じキーの再送は同じ販売結果を返す
* 重複販売を発生させない

---

## 19. CSV出力

### 19.1 sales.csv

含める列:

```text
sale_id
sale_type
payment_method
status
total_amount
paid_amount
change_amount
created_by_role
created_at
canceled_at
product_id
product_name
quantity
unit_price
subtotal
```

### 19.2 stock-events.csv

含める列:

```text
event_id
product_id
product_name
event_type
quantity_delta
related_sale_id
reason
created_by_role
created_at
```

CSVはUTF-8で出力してください。

日本語のExcel互換性を考え、必要ならBOM付きUTF-8にしてください。

---

## 20. 負荷・運用設計

文化祭当日の8時間運用を前提にしてください。

公開ページ:

* 2〜3分ごとの再取得
* 10〜30秒程度の短期キャッシュ
* 正確な在庫数は返さない
* 商品数10以下
* API取得失敗時は最後の表示を残す

レジ画面:

* 販売確定時だけAPIに書き込む
* 商品選択中はAPIに書き込まない
* 確認画面を必ず挟む
* レジ画面の自動更新はしない
* 手動の「在庫を再読み込み」ボタンを置く

---

## 21. エラー設計

### 21.1 レジ画面

```text
在庫不足:
在庫が不足しています。商品選択に戻って確認してください。

通信失敗:
通信に失敗しました。ネットワークを確認してください。

ログイン切れ:
ログインが切れました。もう一度ログインしてください。

二重送信:
すでに確定済みの可能性があります。履歴を確認してください。

サーバーエラー:
処理に失敗しました。管理者に確認してください。
```

### 21.2 公開ページ

```text
最新情報を取得できませんでした。
表示は前回更新時点のものです。
```

---

## 22. セキュリティ仕様

必須:

* すべてのAPI入力をZodで検証する
* 商品価格、合計金額、おつり、在庫数、権限はクライアント値を信用しない
* 公開APIに正確な在庫数を返さない
* HttpOnly Cookieを使う
* SameSite=Laxにする
* 状態変更APIはPOST/PATCHのみ
* SecretをGitHubに保存しない
* ログイン失敗時に詳細な理由を返さない

将来拡張:

* ログイン失敗回数制限
* IP単位の簡易レート制限
* Cloudflare Turnstile

---

## 23. テスト仕様

### 23.1 Unit Test

Vitestで以下をテストしてください。

* 在庫ステータス判定
* 合計金額計算
* おつり計算
* saleTypeごとの挙動
* Zodバリデーション
* ロール判定
* セッション署名
* パスワードハッシュ検証

### 23.2 API Test

以下をテストしてください。

* ログイン成功
* ログイン失敗
* 未ログインでレジAPIを叩くと401
* adminで商品設定APIを叩くと403
* ownerで商品設定APIを叩くと成功
* 在庫不足時に409
* 二重送信時に重複販売されない
* 公開APIに正確な在庫数が含まれない

### 23.3 E2E Test

Playwrightで以下をテストしてください。

* 公開ページ表示
* アレルギーポップアップ表示
* ログイン
* 商品選択
* 確認画面へ進む
* 戻って修正
* お会計確定
* 完了画面表示
* 取消確認
* 在庫なし商品のボタンが押せない

---

## 24. UI方針

デザインは派手にしすぎず、文化祭当日に迷わず使えることを最優先してください。

方針:

* 大きいボタン
* 高いコントラスト
* 読みやすい文字
* 確認画面を必ず挟む
* 重要操作は色と文言で明確にする
* 一般客向けページはスマホ最適化
* スタッフ画面はPC最適化
* CSSは読みやすさを優先

CSS Modulesまたは通常CSSでよいです。

Tailwind CSSを使う場合は、設定が複雑になりすぎないようにしてください。

---

## 25. 当日運用マニュアル

READMEに以下を含めてください。

### 25.1 前日まで

* 商品名を登録
* 価格を登録
* 初期在庫を登録
* アレルギー情報を登録
* admin/ownerのログイン確認
* QRコードを印刷
* 紙のバックアップ表を印刷
* レジPCを決める
* レジPCのスリープを無効化

### 25.2 当日朝

* 公開ページが開ける
* QRコードが読み込める
* レジにログインできる
* テスト販売できる
* テスト販売を取り消せる
* 在庫補正できる
* CSV出力できる
* 商品が売り切れ状態になったときボタンが押せない

### 25.3 営業中

* 商品選択後、必ず確認画面を見る
* お会計確定後に現金を確認する
* 在庫切れ商品は売らない
* 在庫が合わない場合は棚卸し補正を使う
* 通信障害時は紙に記録する

### 25.4 営業終了後

* CSVを出力
* 売上金額と現金を照合
* 在庫イベント履歴を保存
* 改善点をREADMEまたはIssueに記録する

---

## 26. 障害対策

READMEに障害時対応を記載してください。

### 26.1 Cloudflare/API障害

1. 紙に販売数を記録
2. 現金は通常通り扱う
3. 復旧後にまとめて在庫補正
4. CSVのメモ欄または運用メモに障害時間帯を記録

### 26.2 学校Wi-Fi障害

対策:

* レジPCのネット接続を事前確認
* 可能ならスマホテザリングを予備にする
* 紙の販売表を用意する
* レジ端末を増やしすぎない

### 26.3 レジPC障害

対策:

* 予備PCまたはタブレットを用意
* ログイン情報を責任者が管理
* スリープ無効化
* 充電器を常時接続

---

## 27. READMEに書くべき内容

READMEには以下を省略せず書いてください。

```text
# gakuyusai

文化祭食品販売システム。

## 機能
## 技術スタック
## 画面一覧
## API一覧
## DB設計
## 初回セットアップ
## Cloudflare Pagesプロジェクト作成
## D1データベース作成
## migration適用
## Secret設定
## ローカル開発
## テスト
## デプロイ
## 当日運用マニュアル
## 障害時対応
## OSSとしての再利用方法
## ライセンス
```

Cloudflare初回セットアップコマンドとして、少なくとも以下を書いてください。

```bash
npm install

npx wrangler login
npx wrangler whoami

npx wrangler pages project create gakuyusai --production-branch main
npx wrangler d1 create gakuyusai

npx wrangler d1 migrations apply gakuyusai --local
npx wrangler d1 migrations apply gakuyusai --remote

npx wrangler pages secret put ADMIN_USERNAME --project-name gakuyusai
npx wrangler pages secret put ADMIN_PASSWORD_HASH --project-name gakuyusai
npx wrangler pages secret put OWNER_USERNAME --project-name gakuyusai
npx wrangler pages secret put OWNER_PASSWORD_HASH --project-name gakuyusai
npx wrangler pages secret put SESSION_SECRET --project-name gakuyusai
npx wrangler pages secret put PUBLIC_SHOP_NAME --project-name gakuyusai

npm run build
npx wrangler pages deploy dist --project-name gakuyusai
```

---

## 28. Cloudflare作業の実行順序

以下の順番で進めてください。

### Step 1: GitHub

```bash
git clone git@github.com:manruho/gakuyusai.git
cd gakuyusai
git checkout -b feature/initial-gakuyusai
```

### Step 2: npm / Vite

```bash
npm install
```

必要ならVite React TypeScriptを作成してください。

### Step 3: Wrangler

```bash
npm install -D wrangler
npx wrangler login
npx wrangler whoami
```

### Step 4: 既存確認

```bash
npx wrangler pages project list
npx wrangler d1 list
```

### Step 5: Pages作成

存在しなければ実行:

```bash
npx wrangler pages project create gakuyusai --production-branch main
```

### Step 6: D1作成

存在しなければ実行:

```bash
npx wrangler d1 create gakuyusai
```

出力されたdatabase_idを `wrangler.jsonc` に反映してください。

### Step 7: migration

```bash
npx wrangler d1 migrations create gakuyusai initial
```

または手動で `migrations/0001_initial.sql` を作成してください。

### Step 8: local migration

```bash
npx wrangler d1 migrations apply gakuyusai --local
```

### Step 9: build/test

```bash
npm run typecheck
npm run test
npm run build
```

### Step 10: remote migration

ローカルテスト成功後:

```bash
npx wrangler d1 migrations apply gakuyusai --remote
```

### Step 11: deploy

```bash
npx wrangler pages deploy dist --project-name gakuyusai
```

---

## 29. 完了条件

このタスクは、以下を満たしたら完了です。

### 29.1 Cloudflare

* Cloudflare Pages project `gakuyusai` が存在する
* D1 database `gakuyusai` が存在する
* `wrangler.jsonc` にD1 binding `DB` が設定されている
* migrationがlocalで成功している
* 可能ならmigrationがremoteで成功している
* 可能ならCloudflare Pagesへdeployできている

### 29.2 GitHub

* `git@github.com:manruho/gakuyusai.git` で作業している
* 作業ブランチがある
* 変更内容がcommitされている
* force pushしていない
* Secretをcommitしていない

### 29.3 実装

* 公開ページ `/`
* ログイン `/login`
* レジ `/staff/register`
* 在庫 `/staff/stock`
* 管理 `/admin`
* 公開API
* 認証API
* レジAPI
* 在庫API
* 管理API
* CSV出力
* D1 migration
* README
* `.env.example`
* `.dev.vars.example`

### 29.4 テスト

以下が通ること。

```bash
npm run typecheck
npm run test
npm run build
```

可能なら以下も通すこと。

```bash
npm run test:e2e
```

---

## 30. 実装優先順位

時間が足りない場合は、以下の順で実装してください。

### Phase 1: 最重要MVP

1. D1 schema
2. seed data
3. 公開ページ
4. `/api/public/status`
5. ログイン
6. セッション
7. レジ商品取得
8. 販売確定
9. 在庫減算
10. 二重送信防止

### Phase 2: 当日運用に必要

11. 事前販売モード
12. 取消
13. 在庫画面
14. 補充
15. 廃棄
16. 棚卸し補正
17. CSV出力

### Phase 3: owner管理

18. 商品追加
19. 商品編集
20. 価格変更
21. アレルギー情報変更
22. 公開ページON/OFF
23. しきい値変更

### Phase 4: 仕上げ

24. E2Eテスト
25. README整備
26. 当日運用マニュアル
27. 障害対応マニュアル
28. UI改善

---

## 31. 最後に出力する報告

作業完了時に、以下を報告してください。

```text
## 実装完了報告

### 作成・変更した主なファイル
- ...

### Cloudflareで作成したもの
- Pages project: gakuyusai
- D1 database: gakuyusai
- D1 binding: DB

### 実行したコマンド
- ...

### 成功した確認
- npm run typecheck
- npm run test
- npm run build
- migration local
- migration remote
- deploy

### 未完了または手動対応が必要なもの
- Secret設定
- 本番パスワード設定
- QRコード印刷
- 当日リハーサル

### 注意点
- ...
```

---

## 32. この指示書の要点

このプロジェクトでは、Cloudflare Dashboardでの手作業を最小化してください。

Cloudflare上に新しく以下を作成してください。

```text
Cloudflare Pages project: gakuyusai
Cloudflare D1 database: gakuyusai
D1 binding: DB
```

GitHubでは以下を使ってください。

```text
git@github.com:manruho/gakuyusai.git
```

最終的に、文化祭当日の8時間運用に耐え、後輩がREADMEを見て再利用できるOSSとして完成させてください。

```
