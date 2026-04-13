# 競馬予想ツール — プロジェクト概要

## このプロジェクトについて
JRA競馬レースの出走馬データをnetkeibaから取得し、
スコアと長期期待値を自動算出する競馬予想Webアプリ。

**最終目標**: raceIdを入力するだけで全券種の期待値付き
馬券フォーメーションシミュレーターが動作すること。

---

## 技術スタック

| 役割             | 技術                        |
|------------------|-----------------------------|
| フレームワーク   | Next.js 14 (App Router)     |
| 言語             | TypeScript（strictモード）  |
| パッケージ管理   | pnpm                        |
| スクレイピング   | axios + cheerio             |
| キャッシュ       | node-cache (TTL: 600秒)     |
| スタイリング     | Tailwind CSS                |
| テスト           | Vitest                      |
| CI               | GitHub Actions              |

---

## ディレクトリ構成

```
keiba-app/
├── app/
│   ├── api/race/[raceId]/route.ts   # メインAPIエンドポイント
│   ├── components/                  # UIコンポーネント
│   ├── hooks/                       # カスタムフック
│   └── page.tsx
├── lib/
│   ├── scraper/                     # データ取得層
│   │   ├── netkeiba.ts
│   │   └── types.ts
│   └── score/                       # スコア・期待値計算層
│       └── calculator.ts
├── scripts/                         # バックテスト・補正係数最適化
├── tests/                           # テストファイル
└── CLAUDE.md                        # ← このファイル
```

---

## コーディング規約

### 基本方針
- TypeScript strict モードを維持する。`any` 型は原則禁止
- 関数は単一責任。1関数100行を超えたら分割を検討する
- コメントは**日本語**で記述する（変数名・関数名は英語）
- `console.log` は開発用途のみ。本番コードには残さない

### 命名規則
```typescript
// 関数: camelCase
function calcScore(horse: Horse): number {}

// 型・インターフェース: PascalCase
type BetType = 'tan' | 'fuku' | ...

// 定数: UPPER_SNAKE_CASE
const MAX_CORRECTION = 0.20;

// Reactコンポーネント: PascalCase
export function BakenSimulator() {}
```

### エラーハンドリング
- try/catchで必ずエラーをキャッチし、ログを出力する
- スクレイピング失敗時はフィールドを0またはnullで埋め、
  処理を止めない（部分的な成功を許容する）
- APIルートは必ず `{ success: boolean, data, error? }` 形式で返す

---

## 環境変数

| 変数名                | 用途                              | デフォルト |
|-----------------------|-----------------------------------|------------|
| USE_MOCK              | trueのときモックデータを返す      | true       |
| CACHE_TTL_SECONDS     | キャッシュの有効期限（秒）        | 600        |
| SCRAPE_INTERVAL_MS    | スクレイピング間隔（ミリ秒）      | 1000       |
| NETKEIBA_SESSION_COOKIE | セッションCookie（将来用）      | -          |

---

## 絶対に守ること（禁止事項）

1. **`USE_MOCK=false` のままテストを実行しない**
   → 実ネットワークへの過剰アクセスになるため

2. **スクレイピング間隔を1秒未満にしない**
   → netkeiba のレート制限に引っかかるため

3. **`.env.local` をコミットしない**
   → `.gitignore` に必ず含める

4. **スコアの重みの合計を1.0から変えない**
   → 期待値の正規化が崩れるため

5. **期待値の補正係数（CORRECTION_FACTOR）を0.3超にしない**
   → 人気薄の期待値が異常値になるため（過去の失敗から学んだ制約）

---

## フェーズ管理

| フェーズ | 内容                          | 状態     |
|----------|-------------------------------|----------|
| 1-A      | プロジェクト初期化・型定義    | 完了     |
| 1-B      | netkeibaスクレイパー実装      | 完了     |
| 1-C      | スコア・期待値計算ロジック    | 完了     |
| 1-D      | フロントエンドAPI連携         | 完了     |
| 2        | バックテスト・補正係数最適化  | 未着手   |
| 3        | 機械学習モデル導入            | 未着手   |

---

## 参照すべきCLAUDE.md

作業するディレクトリに応じて、以下のCLAUDE.mdも参照すること:
- `lib/scraper/CLAUDE.md` — スクレイパーを触るとき
- `lib/score/CLAUDE.md`   — スコア計算を触るとき
- `app/api/CLAUDE.md`     — APIルートを触るとき
- `app/components/CLAUDE.md` — UIを触るとき
- `scripts/CLAUDE.md`     — スクリプトを実行・編集するとき
