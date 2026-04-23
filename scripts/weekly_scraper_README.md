# 週次スクレイプ運用ドキュメント

## 目的
Phase 2G ハイブリッド戦略の実運用データを継続的に蓄積し、時系列検証の精度を高める。
毎週1回、**GitHub Actions で自動実行** して未取得のレースデータを追加する（手動実行も可）。

## 実行方法

### 🤖 自動実行（運用中）

`.github/workflows/weekly-scrape.yml` により **毎週火曜 08:00 JST** に自動実行される。

**選定タイミングの根拠**:
- JRA は土日開催、**月曜中に netkeiba で成績・払戻が確定**する
- 火曜朝なら前週分の全データが揃っている
- JST 2-6 時禁止帯を確実に回避（cron は UTC=月曜23時=JST火曜08時）
- GitHub Actions のスケジュール遅延（通常 5〜15 分）があっても安全

**実行時間目安**: 4-6 分/回 × 週1回 × 4週 = **16-24 分/月**
GitHub 無料プランの 2000 分/月制限に対して約 1% と十分な余裕。

**通知**: 失敗時は GitHub からメール通知（デフォルト挙動、Secrets 設定不要）。

### 手動実行（GitHub UI）

急ぎで取得したい場合やテスト時:

1. GitHub リポジトリの **Actions** タブを開く
2. 左メニュー **Weekly Race Scraper** を選択
3. **Run workflow** → 対象過去日数を入力（デフォルト 14）→ 実行

### 手動実行（ローカル）

```bash
# デフォルト: 過去 14 日間 (2週間分) を対象
pnpm run weekly-scrape

# 期間を変更したい場合
pnpm run weekly-scrape -- --days 21
```

実行タイミング:
- **自動: 毎週火曜 08:00 JST**（GitHub Actions）
- **手動の場合の推奨**: 月曜〜火曜朝
- **禁止: 深夜 2-6 時 JST** (スクリプトが拒否する)

### 事前チェックリスト

実行前に以下を確認:

1. **netkeiba アクセス可否**
   ```bash
   curl -I "https://race.netkeiba.com/race/shutuba.html?race_id=202506030811"
   # HTTP 200 が返ればOK、400/403なら時間を置く
   ```

2. **前回実行から24時間以上経過**
   - `scripts/verification/weekly_scrape.log` の最終実行時刻を確認

3. **ディスク空き容量**
   - 1 R あたり約 15 KB、週に 100-200 R 増加想定

## 動作仕様

### 自動検出ロジック
1. 実行日から過去 N 日間の日付を列挙 (土日月を対象)
2. 各日付の schedule を scraper で取得
3. `scripts/verification/YYYYMMDD_raceId.json` と照合
4. **既存があればスキップ、なければ取得** (二重取得防止)
5. 取得したデータは既存と同じ命名規則で保存

### レート制限 (collect-verification.ts 由来)
- アクセス間隔: 2 秒以上
- 200 R ごとに 5 分休憩
- HTTP 400/403 検出時はサーキットブレーカ発動

## 実行後の確認

### 成功パターン
```
===== 週次スクレイプ開始 (過去 14 日) =====
✅ netkeiba アクセス確認 OK
対象日付: 4 日 (20260419 〜 20260428)
実行前の JSON 数: 2500
実行後の JSON 数: 2572 (新規 72)
===== 週次スクレイプ完了 =====
```

### ログ確認
- `scripts/verification/weekly_scrape.log` — 週次実行履歴
- `scripts/verification/collect.log` — 詳細な収集ログ (レース単位)

## トラブル対処

### HTTP 400 / 403
- **原因**: netkeiba のレート制限またはブロック
- **対処**: 即座に停止 → **3 時間待機** → 再実行
- 頻発する場合は「1 日あたりの R 数を減らす」等の方針変更

### 「不明」カテゴリが増えた
- **原因**: HTML 構造の変更、新たな表記ゆれの出現
- **対処**:
  1. `scripts/fill_track_condition.ts` で同日補完を試す
  2. 直らない場合は scraper の正規表現を修正 (`lib/scraper/netkeiba.ts`)
  3. 過去事例: 「稍」略記 (コミット `475c27f` で対応)

### 取得失敗レース
- `scripts/verification/collect.log` の `ERROR` 行を確認
- 失敗原因:
  - レース未開催 (schedule に存在するがデータなし)
  - 一時的なネットワークエラー → 次回実行で再取得
  - scraper のバグ → 修正要

## 運用ロードマップ

### 短期 (現在)
- 手動で毎週月曜に実行
- 2026-04 現在: 約 2500R 蓄積済み、毎週 100-200R 追加想定

### 中期 (3ヶ月後目標)
- 3000-3500R に到達
- 時系列変動のパターン (季節性・開催場特性) が見えてくる

### 長期 (本番運用連動)
- GitHub Actions で毎週月曜 06:00 JST に自動実行
- Slack/Discord 通知連携
- 取得失敗の自動アラート

## メンテナンス

### 月 1 回やること
1. `scripts/verification/` のディスク使用量確認
2. `weekly_scrape.log` のサイズチェック (大きくなったら rotation)
3. 新規レース数の推移確認 (急に減ったら異常の兆候)

### 年 1 回やること
1. 古いデータ (2 年以上前) のアーカイブ検討
2. netkeiba の HTML 構造の定期チェック
3. scraper 正規表現の棚卸し

## 関連ファイル

| ファイル | 用途 |
|---|---|
| `.github/workflows/weekly-scrape.yml` | **GitHub Actions ワークフロー (自動実行定義)** |
| `scripts/weekly_scraper.ts` | 週次スクレイプ本体 |
| `scripts/collect-verification.ts` | 下位で呼ばれる収集ロジック |
| `scripts/fill_track_condition.ts` | 馬場状態の補完 (必要に応じて) |
| `scripts/verification/weekly_scrape.log` | 週次実行履歴 |
| `scripts/verification/collect.log` | レース単位の詳細ログ |
| `lib/scraper/netkeiba.ts` | HTML パースロジック (修正対象) |
| `lib/scraper/CLAUDE.md` | スクレイパー仕様書 |

## GitHub Actions 自動化の要点

### cron 設計
```yaml
schedule:
  - cron: '0 23 * * 1'   # 月曜 23:00 UTC = 火曜 08:00 JST
```
- GitHub Actions の cron は **UTC 指定必須**
- JST 2-6 時禁止帯 (UTC 17-21 前日) を避ける
- scheduled run には数分〜十数分の遅延あり、朝8時なら安全マージン大

### Timezone 設定
ワークフロー env に `TZ: Asia/Tokyo` を設定。
`weekly_scraper.ts` の `isForbiddenTime()` が `new Date().getHours()` で判定するため、
デフォルト UTC のままだと禁止時間判定が狂う。

### Permissions
```yaml
permissions:
  contents: write   # 自動コミット/push に必要
```
リポジトリ設定の Actions → General → Workflow permissions が **Read/write** になっている必要あり。

### Concurrency
```yaml
concurrency:
  group: weekly-scrape
  cancel-in-progress: false
```
手動実行とスケジュール実行が重なった場合の二重取得を防ぐ。

### 自動コミット
`github-actions[bot]` 名義で `scripts/verification/` に差分が出たときのみコミット。
休開催週など新規0件なら正常終了扱い。

### 失敗時の対処
1. GitHub Actions タブで失敗ログ確認
2. HTTP 400/403 なら **手動実行を 3 時間以上空ける**
3. スクレイパー正規表現の破綻なら `lib/scraper/netkeiba.ts` を修正
4. 継続失敗時は workflow を一時停止（Actions タブから Disable workflow）

### 想定月間消費時間
- 依存関係インストール: 1-2 分（pnpm キャッシュ効く）
- 差分検出 + 取得: 2-3 分（新規 50-60R × 2秒 + 休憩）
- コミット/push: 30 秒
- **合計: 4-6 分/回 × 4週 ≒ 16-24 分/月**（2000 分無料枠の 1% 程度）

## 過去の事故記録

### 2026-04-19: 795R 一括取得でブロック発生
- 65 分連続アクセスが原因
- 対策: 30 分ごとに 5 分休憩 → BATCH_MAX_SIZE=200 を導入
- コミット: `09e4fea`

### 2026-04-22: 「稍」略記の取得漏れ
- 小倉1回8日目 12R で馬場状態が「稍」と略記され regex 未マッチ
- 対策: `/馬場[:：](良|稍重|稍|重|不良)/` + 「稍」→「稍重」変換
- コミット: `475c27f`
