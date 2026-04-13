# 競馬予想ツール

netkeibaのデータをスクレイピングし、馬ごとのスコアと期待値を自動算出するWebアプリです。

## 技術スタック

- **Next.js 14** (App Router) + TypeScript
- **pnpm** パッケージマネージャー
- **axios** HTTPクライアント
- **cheerio** HTMLパーサー
- **node-cache** データキャッシュ（TTL 10分）
- **dotenv** 環境変数管理

## セットアップ

```bash
# 依存関係のインストール
pnpm install

# 環境変数の設定
cp .env.local.example .env.local

# 開発サーバー起動
pnpm dev
```

## APIエンドポイント

### `GET /api/race/[raceId]`

netkeibaのレースIDを指定してレース情報を取得します。

**パラメータ**
- `raceId`: 12桁のnetkeibaレースID（例: `202606030511`）

**レスポンス例**
```json
{
  "success": true,
  "data": {
    "raceId": "202606030511",
    "name": "ニュージーランドトロフィー",
    "course": "中山",
    "distance": 1600,
    "surface": "turf",
    "horses": [...],
    "fetchedAt": "2026-04-11T10:00:00.000Z"
  }
}
```

**動作確認**

```bash
curl http://localhost:3000/api/race/202606030511
```

## 環境変数

| 変数名 | 説明 | デフォルト |
|--------|------|-----------|
| `NETKEIBA_SESSION_COOKIE` | netkeibaセッションCookie（将来用） | - |
| `CACHE_TTL_SECONDS` | キャッシュTTL（秒） | `600` |
| `USE_MOCK` | `true`のときモックデータを返す | `true` |

## 動作確認

```bash
# 開発サーバー起動
pnpm dev

# ブラウザで確認
open http://localhost:3000

# APIレスポンス確認（モックデータ）
curl http://localhost:3000/api/race/202606030511
```

## スクレイパーテスト

```bash
# モックデータで動作確認（ネットワーク不要）
USE_MOCK=true pnpm tsx scripts/test-scraper.ts 202606030511

# 実データ取得（ネットワーク必要・netkeibaにアクセスします）
USE_MOCK=false pnpm tsx scripts/test-scraper.ts 202606030511
```

> **注意**: `USE_MOCK=false` での実行はnetkeibaへの実アクセスが発生します。
> 連続実行は控えてください（レート制限: リクエスト間隔 1 秒以上）。

## ディレクトリ構成

```
keiba-app/
├── app/
│   ├── api/race/[raceId]/route.ts  # レース情報取得API
│   └── page.tsx                     # トップページ（仮）
├── lib/
│   ├── scraper/
│   │   ├── __mocks__/
│   │   │   └── 202606030511.ts     # NZT 2026 モックデータ（15頭）
│   │   ├── netkeiba.ts             # スクレイパー実装
│   │   └── types.ts                # 型定義
│   ├── score/
│   │   └── calculator.ts           # スコア計算（Phase 1-C以降実装）
│   └── cache.ts                    # node-cacheラッパー
├── scripts/
│   └── test-scraper.ts             # スクレイパー動作確認スクリプト
├── .env.local.example
├── .gitignore
└── README.md
```
