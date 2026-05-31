# AGENTS

- 実装は `plan.md` を仕様として扱う。
- Cloudflare 向けの設定は `wrangler.jsonc` を優先する。
- `.env` と `.dev.vars` はコミットしない。
- 無闇な `main` 直コミット / 直 push は避ける。変更は原則として作業ブランチを切ってから反映する。
- 既存の作業は `codex/*` のような作業ブランチで進め、`main` は直接触らない。
