# 品質監査部 軽量設計提案

| 項目 | 値 |
|---|---|
| 提案日 | 2026-05-23 |
| 背景 | feasibility 調査 + prevClass 究明で「スコア5要素 (`lastThreeF`/`training`/`courseRecord`/`prevClass`/`breeding`) が全件 50/同一値で数ヶ月放置」事件が発覚 |
| 目的 | この種類の「**サイレントに 50 フォールバックが全件発動する**」異常を早期検知する |
| 設計方針 | 過剰設計回避、最小構成から段階導入、既存 `weekly-scrape.yml` workflow と整合 |

---

## 1. 監査スコープの定義

### 今回の事件で「あれば検知できた」項目

| # | 異常 | 検知の容易さ | 重要度 |
|---|---|---|---|
| A | `components.X` が全件で同一値（distinct=1）| 🟢 簡単 | ★★★ |
| B | `components.X` が中央値50に偏りすぎ（>90%が50）| 🟢 簡単 | ★★★ |
| C | 2要素の値が常に等しい（`lastThreeF === training`）| 🟢 簡単 | ★★ |
| D | `pastRaces` 保存率の急激な低下 | 🟢 簡単 | ★★★ |
| E | スコア・EV分布の急激な変化（過去窓との差分）| 🟡 中 | ★★ |
| F | 新規収集 R 数が想定より大幅に少ない | 🟢 簡単 | ★★ |
| G | バックテストの前後半差・サンプル数違反 | 🟡 中 | ★ |
| H | スクレイパー HTTP エラー率の急増 | 🟡 中 | ★★ |

### 監査スコープ（提案）

**フェーズ1（即着手）** で対応する4項目：

| ID | 監査項目 | 対象 |
|---|---|---|
| **AUD-1** | `components` 各要素の distinct 値数 | 全件 / 直近100R / 直近30日 |
| **AUD-2** | `components` 各要素の 50 占有率 | 全件 / 直近100R / 直近30日 |
| **AUD-3** | 2要素の同一性（`lastThreeF === training` 馬の割合）| 全件 / 直近100R |
| **AUD-4** | `pastRaces` 保存率 | 直近100R / 直近30日 / 全件 |

**フェーズ2** で追加：

| ID | 監査項目 | 対象 |
|---|---|---|
| **AUD-5** | スコア分布の窓比較（中央値・最大・最小の急変） | 直近100R vs 過去全体 |
| **AUD-6** | EV 中央値の健全性 (期待 0.85〜1.10) | 直近100R |
| **AUD-7** | 新規収集 R 数の推移（週次の落ち込み検知） | 直近4週 |
| **AUD-8** | スクレイパー HTTP エラー集計（collect.log パース） | 直近実行ログ |

**フェーズ3（将来構想）**：

- バックテスト戦略との連携（前後半差・サニティチェックの自動化）
- GitHub Issue 自動作成・通知
- ダッシュボード可視化

---

## 2. 実装方針

### 実行環境（推奨）

**両対応**だが優先度を分ける：

| 環境 | 用途 | 頻度 | 設定 |
|---|---|---|---|
| **GitHub Actions cron** | 週次の定期監査 | 毎週水曜 09:00 JST（週次スクレイプ翌日）| `.github/workflows/audit.yml` 新設 |
| **ローカル手動** | アドホック調査・新機能検証 | 必要時 | `pnpm tsx scripts/audit/run_audit.ts` |

理由：
- **GitHub Actions**: 自動化で人手忘れを防ぐ。週次スクレイプの翌日に走らせれば、最新データで監査が回る
- **ローカル**: 開発中の即時確認・コミット前チェック用。Actions に依存しない

### 出力形式

| 形式 | 用途 | 配置 |
|---|---|---|
| **Markdown レポート** | 人間が読む | `scripts/audit/output/audit_YYYYMMDD.md`（自動上書きせず日付付きで蓄積） |
| **JSON** | プログラム連携・トレンド追跡 | `scripts/audit/output/audit_YYYYMMDD.json` |
| **コンソール** | CI ログで読む | summary 部のみ stdout |

### 配置先

```
scripts/audit/
├── run_audit.ts                 # エントリポイント
├── checks/
│   ├── components_distribution.ts  # AUD-1, AUD-2, AUD-3
│   └── data_coverage.ts            # AUD-4
├── output/
│   ├── audit_20260523.md
│   └── audit_20260523.json
└── README.md
```

### 通知方法（段階導入）

| フェーズ | 通知 |
|---|---|
| 1 | GitHub Actions ログに `::warning::` / `::error::` を出力（D-1 サイズ警告と同じ流儀）|
| 2 | リポジトリ内 `docs/audits/` に履歴を蓄積、最新レポートを README からリンク |
| 3 | 重大異常 (★★★) で GitHub Issue 自動作成 |

→ **当面は ::warning:: で十分**。GitHub Actions の Annotations 機能で警告マークが付く。

---

## 3. 異常検知基準（初期セット）

### AUD-1: components 各要素の distinct 値数

```
対象: components の 7 要素 × 集計対象
基準:
  - distinct < 3   → ★★★ ERROR (今回の事件再現、即対応)
  - distinct < 10  → ★★ WARNING
  - distinct < 50  → ★ NOTICE
```

**根拠**: 49,033頭でも distinct=1 (lastThreeF/training/courseRecord/prevClass/breeding) の事例があった。distinct=3 未満は明らかに病的。50 を境にしたのは feasibility 調査の `weightChange: 6 種類` と `lastThreeF: 97 種類` の中間。

### AUD-2: 50 占有率

```
対象: components の 7 要素
基準:
  - 50占有率 > 80% → ★★★ ERROR (全件50固定タイプ)
  - 50占有率 > 50% → ★★ WARNING
  - 50占有率 > 30% → ★ NOTICE
```

**根拠**: feasibility 調査で `prevClass/breeding/courseRecord` が 100.0% / `jockey` が 9.3% (取得失敗) だった。80% は明らかに病的、50% でも警戒、30% は普通の取得失敗率。

ただし **weightChange は離散値の性質上、50 が多くなりがち**（±4kg=85, ±0=100 等の段階で 50 を含む）→ AUD-2 の対象から除外、または weightChange のみ閾値を緩める。

### AUD-3: 2要素の同一性

```
対象: lastThreeF === training の馬の割合
基準:
  - 同一割合 > 95% → ★★★ ERROR (Phase 2H D-1 以前の旧ロジック残存)
  - 同一割合 > 50% → ★★ WARNING (一部だけ旧 JSON 混在)
```

**根拠**: Phase 2H D-1 で独立化済。新規収集分は同一割合 < 5% になるはず。95% 以上残っているなら新形式が動いていない or 旧 JSON のみを見ている。

### AUD-4: pastRaces 保存率

```
対象: 直近100R / 直近30日 / 全件
基準:
  - 直近100R で 保存率 < 80% → ★★★ ERROR (D-1 改修が機能していない)
  - 直近100R で 保存率 < 95% → ★★ WARNING (個別馬の取得失敗多発)
  - 全件で 保存率 < 30%       → ★ NOTICE (旧データ未再収集、D-3 候補)
```

**根拠**: D-1 改修後（5-26 火曜以降）の新規収集分は 100% に近いはず。80% を下回ったらスクレイパー or workflow に問題。30% は D-3 完了の進捗指標。

### AUD-5（フェーズ2）: スコア分布の窓比較

```
対象: 直近100R の score 中央値 vs 全件中央値
基準:
  - 差分絶対値 > 10pt → ★★ WARNING (重み変更 or バグの可能性)
  - 差分絶対値 > 5pt  → ★ NOTICE
```

**根拠**: WEIGHTS 変更や scoreFunc バグで分布が動く。10pt はかなり大きな変化。

### AUD-6（フェーズ2）: EV 中央値

```
基準: 0.85 〜 1.10 の範囲外 → ★★ WARNING
```

既存 `validateScores` と同基準。

---

## 4. 段階導入プラン

### フェーズ1: 最小構成（即着手可能）

**スコープ**: AUD-1, AUD-2, AUD-3, AUD-4 のみ

**成果物**:
- `scripts/audit/run_audit.ts`（単一ファイル、~150-200行）
- 出力: Markdown レポート 1 つ
- 実行: ローカル手動 `pnpm tsx scripts/audit/run_audit.ts`

**工数**: 半日（4時間）

**カバー範囲**: 今回の事件タイプ（components 50固定）は完全に検知できる。次回起きたら 1分以内に発見可能。

### フェーズ2: 拡張 + 自動化

**追加スコープ**: AUD-5, AUD-6, AUD-7, AUD-8 + GitHub Actions

**追加成果物**:
- `.github/workflows/audit.yml`（毎週水曜 09:00 JST cron）
- `scripts/audit/checks/score_distribution.ts`
- `scripts/audit/checks/scraper_log_parser.ts`
- 出力 JSON を機械可読化（トレンド分析用）

**工数**: 1-2日

**カバー範囲**: 週次で自動稼働、人手忘れ防止。Actions ログに warning マーク。

### フェーズ3: 将来構想

- バックテスト戦略部との連携（前後半差・サニティ自動チェック）
- GitHub Issue 自動作成（重大異常時）
- ダッシュボード可視化（dashboard-data.json と統合）

**工数**: 別タスクで設計提案

---

## 5. 既存 workflow との整合性

### D-1 で追加したサイズ警告との対比

| 項目 | D-1 サイズ警告 | 本提案 (フェーズ1) |
|---|---|---|
| 配置 | `weekly-scrape.yml` の step | 別 workflow `audit.yml` |
| タイミング | スクレイプ直後 | スクレイプ翌日 (水曜) |
| 出力 | `::warning::` 1行 | Markdown レポート + ::warning:: |
| 対象 | リポジトリサイズ 1指標 | components 7要素 + pastRaces 等 |
| 工数 | 数行 | 4時間 |

→ 性質が違う（軽量サイズ監視 vs 構造化監査）ため**別 workflow で分離**するのが整合的。両者は独立に動作。

### 既存スクリプトとの差分

| 既存 | 本提案 |
|---|---|
| `test-score.ts`: モック1レースで健全性チェック | 監査: 全件 (3557+) で分布チェック |
| `test_verification_backward_compat.ts`: D-1 後方互換 | 監査: 継続的に走らせる |
| `verify_kiken_popular.ts`: 危険人気馬の分析 | 監査: スコア要素の健全性自体 |

→ 既存は **特定ロジックの動作確認**、本提案は **継続的な異常検知**。役割が異なる。

---

## 6. フェーズ1 着手時の工数見積もり

### 内訳

| タスク | 時間 |
|---|---|
| `scripts/audit/run_audit.ts` 骨格作成（JSON ロード + 集計ループ） | 1h |
| AUD-1, AUD-2 実装 | 30m |
| AUD-3 実装 | 15m |
| AUD-4 実装（直近100R の絞り込みロジック） | 30m |
| Markdown 出力フォーマット | 1h |
| 実行テスト + 出力確認 | 30m |
| README + 既存ドキュメント整合 | 15m |
| **合計** | **約 4 時間（半日）** |

### 即着手の前提条件
- 別タスクで進行中の本実装（prevClass 修正など）と独立に着手可能
- 既存 verification JSON 3,557件をそのまま使うため新規データ収集なし
- D-1 で導入した型 (`VerificationData` + `components`) をそのまま使える

---

## 7. 提案サマリ

### Yes/No 判断

| 項目 | 判断 |
|---|---|
| フェーズ1 即着手するか | 🟢 **推奨**。半日で次の事件を防げる |
| フェーズ2 自動化するか | 🟡 フェーズ1 運用1〜2ヶ月後に判断 |
| 既存 weekly-scrape.yml に組み込むか | 🔴 **非推奨**。別 workflow で分離 |
| GitHub Issue 自動作成するか | 🔴 まだ早い。フェーズ3 以降 |

### 推奨次アクション

1. **本タスクは設計で終了**
2. マー君判断で **フェーズ1 着手 OK** なら、別タスクとして実装着手
3. フェーズ1 完了後、1-2ヶ月運用してから フェーズ2 拡張を判断
4. 「次の事件が起きないか」を実証データで確認してから機能拡張する

---

## 付録: 出力レポートのモックアップ（フェーズ1 想定）

```markdown
# verification データ品質監査レポート

| 項目 | 値 |
|---|---|
| 実行日時 | 2026-05-23 21:00 JST |
| 対象 | scripts/verification/*.json 合計 3,557 ファイル |
| 直近100R | 20260517_*.json 〜 |
| 直近30日 | 2026-04-23 〜 2026-05-23 |

## サマリ
- 🔴 ERROR: 5 件
- 🟡 WARNING: 0 件
- 🟢 NOTICE: 2 件

## AUD-1: components distinct 値数

| 要素 | 全件 | 直近100R | 判定 |
|---|---|---|---|
| lastThreeF   |  97 |  85 | 🟢 |
| training     |  97 |  85 | 🟢 |
| courseRecord |   1 |   1 | 🔴 ERROR (distinct < 3) |
| prevClass    |   1 |   1 | 🔴 ERROR |
| breeding     |   1 |   1 | 🔴 ERROR |
| weightChange |   6 |   6 | 🟢 (離散値で正常) |
| jockey       | 976 | 234 | 🟢 |

## AUD-2: 50 占有率

| 要素 | 全件 占有率 | 直近100R 占有率 | 判定 |
|---|---|---|---|
| courseRecord | 100.0% | 100.0% | 🔴 ERROR |
| prevClass    | 100.0% | 100.0% | 🔴 ERROR |
| breeding     | 100.0% | 100.0% | 🔴 ERROR |
| jockey       |   9.3% |   8.5% | 🟢 |

## AUD-3: lastThreeF === training の馬

| 範囲 | 同一割合 | 判定 |
|---|---|---|
| 全件 | 100.0% | 🔴 ERROR (Phase 2H D-1 以前の旧ロジック残存) |
| 直近100R | 100.0% | 🔴 ERROR |

## AUD-4: pastRaces 保存率

| 範囲 | 保存率 | 判定 |
|---|---|---|
| 全件 | 0.0% (0 / 3557) | 🟢 NOTICE (D-3 候補) |
| 直近100R | 0.0% (0 / 100) | 🔴 ERROR (D-1 改修が機能していない) |

## 結論
直近100R で 5件の ERROR を検知。Phase 2H D-1 改修後の収集データに
pastRaces が反映されていない可能性が高い。または collect-verification.ts
が改修ブランチで動作していない疑いあり。要調査。
```

→ 報告様式はこのくらいの密度。1分で全体把握できる構造を意図。

以上。
