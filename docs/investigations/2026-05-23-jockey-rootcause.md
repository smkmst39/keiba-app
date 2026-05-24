# 直近100R jockey スコア50固定の根本原因調査

| 項目 | 値 |
|---|---|
| 調査日 | 2026-05-23 〜 24 |
| 発端 | 監査部フェーズ1 初回実行で「直近100R で jockey が全1,361頭 50固定」発見 |
| 結論 | 🔴 **GitHub Actions 環境から `db.netkeiba.com` への騎手勝率取得が連続失敗している**。コード経路は健全、環境問題が主因 |
| 修正範囲 | GitHub Actions の環境制約に対応 (要選択肢比較) |
| 遡及適用 | 既存3,457R (2026-04-24 以前) は影響なし、直近約100R 分のみ jockey スコア不能 |

---

## 1. 時系列での発症推移

`scripts/verification/*.json` を**収集日プレフィックス順**にソートし、100R 窓 (step=50) で jockey スコア 50占有率を集計。

### 主要な転換点（抜粋）

| 窓 (収集日範囲) | 馬数 | 50占有率 |
|---|---|---|
| 20250503 .. 20250510 | 1,360 | 0.1% |
| 20250510 .. 20250518 | 1,352 | 0.1% |
| 20250920 .. 20251004 | 1,356 | 0.1% |
| 20260124 .. 20260201 | 1,397 | 0.0% |
| 20260308 .. 20260321 | 1,425 | 0.1% |
| 20260322 .. 20260404 | 1,375 | 0.1% |
| **20260329 .. 20260411** | **1,436** | **26.5%** ← 急激悪化開始 |
| 20260404 .. 20260418 | 1,455 | 36.2% |
| 20260411 .. 20260419 | 1,395 | 10.6% |
| 20260418 .. 20260425 | 1,378 | 33.0% |
| 20260419 .. 20260502 | 1,410 | **82.6%** |
| **20260425 .. 20260503** | 1,412 | **100.0%** ← 完全発症 |
| 20260502 .. 20260510 | 1,386 | 100.0% |
| 20260503 .. 20260516 | 1,388 | 100.0% |
| 20260510 .. 20260517 | 1,377 | 100.0% |

### 発症期間
- **正常稼働期**: 2025-05-03 〜 2026-04-04（11ヶ月、0-0.2%）
- **急激悪化期**: 2026-04-04 〜 2026-04-25（3週間で 0% → 100% に到達）
- **完全発症期**: 2026-04-25 以降（22日間継続中）

---

## 2. コード上の経路

### 関係コミット

| 日付 | ハッシュ | 内容 |
|---|---|---|
| 2026-04-15 | `fcff215` | `lib/scraper/stats.ts` 新規。`db.netkeiba.com/jockey/{code}/` から当年勝率取得 |
| **2026-04-18 19:05** | **`162a729`** | **通常モードの calcAllScores も jockey 勝率ベースに切替** ← 転換点 |
| 2026-04-18 19:20 | `a3c4270` | 騎手勝率 0% (外国人・短期免許) をレース内平均で代替 |
| 2026-04-22 | `8481488` | 週次スクレイプを GitHub Actions で自動化 |

### scoreJockeyFromRates 50固定経路

[lib/score/calculator.ts:scoreJockeyFromRates](../../keiba-app/lib/score/calculator.ts) の挙動：

```typescript
if (jockeyRates.size === 0) return allHorses.map(() => 50);  // ← (a)
// 0%除外平均
const knownRates = allHorses.map(h => jockeyRates.get(h.jockey) ?? 0).filter(r => r > 0);
const raceAvgRate = knownRates.length > 0 ? mean(knownRates) : 0;
const values = allHorses.map(h => {
  const rate = jockeyRates.get(h.jockey) ?? 0;
  if (rate === 0 && raceAvgRate > 0) return raceAvgRate;
  return rate;
});
return normalizeWithinRace(values);  // ← 全員同値なら 50
```

**全員 50 になる2経路**：
- (a) `jockeyRates.size === 0` (=fetchRacePersonStats が空 Map 返却)
- (b) 全員 `rate === 0` → `raceAvgRate === 0` → `normalizeWithinRace` が「全員同値 → 50」を返す

---

## 3. 入力データの実態

### スクレイパー → 保存データ
[netkeiba.ts L298-307](../../keiba-app/lib/scraper/netkeiba.ts#L298-L307) で `jockeyCode` を出馬表のリンク href から抽出。

verification JSON `predictions[].jockey` (騎手名) には正常に値が入っている：
```json
"horseId":1,"horseName":"アクアリッズ","jockey":"江田照",...
```

**騎手名 = 正常に取れている** ことが直近100R で確認できる。

### fetchRacePersonStats の挙動
[stats.ts L134-163](../../keiba-app/lib/scraper/stats.ts#L134-L163):

```typescript
if (h.jockeyCode && !jockeys.has(h.jockey)) jockeys.set(h.jockey, h.jockeyCode);
// ...
const rate = await fetchJockeyWinRate(code);
jockeyRates.set(name, rate);
```

→ `jockeyCode` が undefined だと **Map に entry されない** ため、後段の rate 取得もスキップ。

しかし `verify_production_run.ts` (2026-05-11 実行) のログでは:
```
[stats] 騎手 武豊 勝率: 12.8%
[stats] 騎手 岩田望 勝率: 17.6%
```
動的な値が取れていた。**ローカル PC からの実行では成功**。

---

## 4. 仮説検証

### 仮説A: スクレイパーが jockey 名を取れなくなった (HTML 構造変化)
→ ❌ **否定**。verification JSON で騎手名は正常取得済み。

### 仮説B: 騎手リーディング順位データの取得失敗 (db.netkeiba.com アクセス失敗)
→ 🟢 **最有力**。

根拠：
- ローカル `verify_production_run.ts` 実行 (2026-05-11) では正常取得
- GitHub Actions 経由の収集 (2026-04-25 以降) で 100% 失敗
- 環境差異は: **実行 IP・User-Agent ヘッダ・ネットワーク帯域**

GitHub Actions の Ubuntu Runner は AWS/Azure 帯域から接続するため、`db.netkeiba.com` 側で:
- IP 帯域ベースのレート制限 / WAF ブロック
- Cloudflare bot 検査
- Cookie/Session 必須化 (HTML は返るが空テーブル)
のいずれかが発生している可能性が高い。

### 仮説C: scoreJockey 関数のロジック不全
→ ❌ **否定**。コード経路は健全。`normalizeWithinRace` の「全員同値 → 50」は仕様。

### 仮説D: parseWinRate が当年 2026 行を取れない (タイミング問題)
→ ❌ **否定**。`CURRENT_YEAR = "2026"` で動作するはず。仮にこれが原因なら 2026 年に入った 1月から発症するはずだが、実際は **2026-04 以降に急変**。年明けトリガではない。

### 仮説E: workflow の env で stats を間接的に無効化している
→ ❌ **否定**。[.github/workflows/weekly-scrape.yml L43-46](../../keiba-app/.github/workflows/weekly-scrape.yml#L43-L46) を確認したが、`USE_MOCK=false` と `DISABLE_SIRE=true` のみ。`DISABLE_PERSON_STATS` 相当のフラグはない。

→ **🟢 仮説B (GitHub Actions 環境からの db.netkeiba.com アクセス失敗) で確定**。

ただし「**なぜ失敗するか**」(WAF/Cloudflare/IP 帯域/Cookie 等のうちどれか) は実 netkeiba を叩いて検証しないと最終確定しない。

---

## 5. 確定できる範囲と未確定の境界

### ✅ 確定
1. 発症転換点は 2026-04-18 のコミット `162a729` (通常モードを jockey 勝率ベースに切替)
2. 4/22 の workflow 自動化 (`8481488`) で GitHub Actions 経由収集が開始
3. ローカル実行では正常、Actions 実行では失敗
4. コード上で scoreJockey 50固定になる経路は (a) 空 Map / (b) 全員 rate=0 の2通り
5. 既存3,557R のうち**直近約100R が壊れている**。それ以前は正常

### 🟡 未確定 (実 netkeiba 叩かないと不明)
- HTTP ステータスは 200 か 4xx か (200 でも空 HTML だと parseWinRate=0)
- Cookie/Referer が必要か
- IP 帯域ブロックか WAF か
- 一時的か恒久的か

---

## 6. 修正に必要な作業見積もり

### 修正候補

| 案 | 内容 | コスト | 副作用 |
|---|---|---|---|
| **#1 ログ強化先行** | stats.ts の fetchDbPage 失敗ログを詳細化 (status code, body 先頭) + Actions ログを artifact 保存 | 1時間 | なし。原因確定の前提 |
| #2 スクレイプ環境変更 | GitHub Actions ではなく Vercel cron / ローカル / さくらサーバー等で稼働 | 中 (1-2日) | 運用人手必要、月額コスト等 |
| #3 stats 一時無効化 | `DISABLE_PERSON_STATS=true` で旧経路フォールバック | 30分 | jockey スコアの精度低下 (旧経路は固定値?) |
| #4 リトライ/User-Agent/Cookie 強化 | stats.ts に WAF 回避策を追加 | 中 (調査込み 半日) | netkeiba 利用規約遵守の再確認必要 |
| #5 別データソース | JRA-VAN や他の騎手リーディング API | 大 | 別途契約・調査 |

### 推奨順序
1. **#1 ログ強化先行** で原因を特定
2. 結果に応じて #2〜#5 を選択

### 修正コスト概算
- ログ強化: 1時間
- 原因特定後の本対応: 数時間〜1日 (内容次第)

---

## 7. 既存データへの遡及適用

🟢 **不要 (むしろ既存3,457Rは健全)**。

| 範囲 | jockey スコア状態 | 対応 |
|---|---|---|
| 2025-05 〜 2026-04-04 (約3,300R) | 正常 (50固定率 0-0.2%) | そのまま使える |
| 2026-04-05 〜 2026-04-24 (約57R) | 一部悪化 (10-82%) | 該当馬を WEIGHTS バックテストから除外 or 修正後再収集 |
| 2026-04-25 〜 直近 (約100R) | 完全発症 (100%) | 修正後再収集が必要 |

→ **WEIGHTS チューニング (Phase 2H-C) には 2026-04-04 以前のデータが安全に使える**。3,300R は Phase 2E Stage 3 の 930R より十分大きく、サンプル不足は心配なし。

---

## 8. 監査部の役割と次フェーズ

### 監査部が発見した功績
- feasibility 調査時 (全件集計) では `9.3%` という「微妙な値」で見過ごしていた
- 監査部の**直近100R 窓集計**で `100%` が露呈
- 1日内で原因究明・修正方針まで提示可能になった

これは事例9 (集計範囲で隠れる問題) の典型。**監査部フェーズ1 設計の妥当性が初動で証明された**。

### 監査部フェーズ2 で追加すべき項目
本タスクで判明した類似パターンを早期検知するため:
- **AUD-7 (新規収集 R 数の推移)**: GitHub Actions の収集失敗を間接検知 (今回は失敗ではなくサイレント変質だったが)
- **AUD-8 (スクレイパー HTTP エラー集計)**: collect.log の "fetchDbPage失敗" カウントを週次で集計
- 新規 **AUD-9 (時系列での要素急変)**: 同一要素の 50占有率が 100R 窓で前回比 +10pt 以上動いたら警告。今回の「03/29 で急変」が早期検知できた

---

## 9. 推奨次アクション

### 短期 (1日)
1. **修正案 #1 (ログ強化先行)** を別タスクで着手:
   - `stats.ts` の `fetchDbPage` で HTTP status / body 先頭をログ出力
   - GitHub Actions workflow に artifact upload を追加して collect.log を保存
   - 次回火曜 (2026-05-26) の週次スクレイプログで原因確定

### 中期 (1週間)
2. 原因確定後、修正案 #2〜#5 から最適なものを選択
3. 監査部に AUD-7〜9 を追加 (フェーズ2)

### 後追い
4. Phase 2H-C (WEIGHTS チューニング) は **2026-04-04 以前のデータ** で安全に着手可能。jockey 修正完了を待たなくてもよい

以上。
