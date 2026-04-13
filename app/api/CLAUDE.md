# APIエンドポイント仕様

## エンドポイント一覧

| メソッド | パス                        | 用途                     |
|----------|-----------------------------|--------------------------|
| GET      | /api/race/[raceId]          | レース全情報取得         |
| GET      | /api/race/[raceId]/odds     | オッズのみ再取得（軽量） |
| GET      | /api/health                 | ヘルスチェック           |

---

## レスポンス形式（統一）

```typescript
// 成功時
{
  success: true,
  data: Race,           // lib/scraper/types.ts の Race型
  meta: {
    fetchedAt: string,  // ISO8601形式
    cached: boolean,    // キャッシュから返したか
    mock: boolean,      // モックデータか
  }
}

// エラー時
{
  success: false,
  data: null,
  error: {
    code: 'SCRAPE_FAILED' | 'INVALID_RACE_ID' | 'NOT_FOUND' | 'RATE_LIMITED',
    message: string,    // 日本語のエラーメッセージ
  }
}
```

---

## raceId のバリデーション

```typescript
// netkeibaのraceId形式: 12桁の数字
// 例: 202606030511
//     ↑年4桁 ↑場コード2桁 ↑回2桁 ↑日2桁 ↑R2桁

const RACE_ID_REGEX = /^\d{12}$/;

function validateRaceId(raceId: string): boolean {
  return RACE_ID_REGEX.test(raceId);
}
```

---

## キャッシュ戦略

```
レースデータ（出馬表・馬名）: TTL=3600秒（1時間）
オッズデータ:                  TTL=300秒（5分）※発走直前は短くする
調教データ:                    TTL=86400秒（24時間）※レース前日以降は更新しない
```

キャッシュキー: `race:{raceId}:full` / `race:{raceId}:odds`

---

## エラーコードと対処

| コード           | 意味                       | クライアントへの指示         |
|------------------|----------------------------|------------------------------|
| INVALID_RACE_ID  | raceId形式不正             | 12桁の数字を入力してください |
| NOT_FOUND        | 該当レースなし             | raceIdを確認してください     |
| SCRAPE_FAILED    | スクレイピング失敗         | しばらくして再試行してください |
| RATE_LIMITED     | アクセス過多               | 1分後に再試行してください    |

---

## HTTPステータスコード

| 状況               | コード |
|--------------------|--------|
| 正常               | 200    |
| バリデーションエラー| 400   |
| 未発見             | 404    |
| スクレイピング失敗 | 503    |
| レート制限         | 429    |
