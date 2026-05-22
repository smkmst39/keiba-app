# WEIGHTS バックテスト実行可能性調査

| 項目 | 値 |
|---|---|
| 調査日 | 2026-05-23 |
| 調査対象 | `scripts/verification/*.json` 既存 3,557 ファイル（合計 49,033 頭分） |
| 目的 | Phase 2H-C (WEIGHTS 再チューニング) を既存データだけでどこまで実行可能か |
| 結論 | 🔴 **既存データだけでは実質的に不可能**。新規データ蓄積 (D-2/D-3) を待つ必要あり |

---

## 1. 現状の WEIGHTS 構成

[lib/score/calculator.ts:17-25](../../keiba-app/lib/score/calculator.ts#L17-L25) の `WEIGHTS` 定数：

```typescript
const WEIGHTS = {
  lastThreeF:   0.244,  // 上がり3F
  training:     0.125,  // 調教ラスト1F
  courseRecord: 0.198,  // 同コース成績
  prevClass:    0.146,  // 前走クラス
  breeding:     0.158,  // 血統適性
  weightChange: 0.071,  // 馬体重増減
  jockey:       0.058,  // 騎手評価
} as const;  // 合計 1.000
```

### 各要素の依存データ（コード追跡結果）

| 要素 | スコア関数 | 必須入力 | pastRaces 依存 |
|---|---|---|---|
| lastThreeF | `scoreLastThreeF` ([L211-231](../../keiba-app/lib/score/calculator.ts#L211-L231)) | `horse.pastRaces[0].lastThreeF` | **依存** |
| training | `scoreTraining` ([L233-256](../../keiba-app/lib/score/calculator.ts#L233-L256)) | `horse.lastThreeF` (調教近似秒) | 非依存 |
| courseRecord | `scoreCourseRecord` ([L283-302](../../keiba-app/lib/score/calculator.ts#L283-L302)) | `horse.pastRaces` + `race.{course,surface,distance,raceDate}` | **依存** |
| prevClass | `scorePrevClass` ([L320-324](../../keiba-app/lib/score/calculator.ts#L320-L324)) | `horse.prevRaceClass` or `horse.prevRaceName` | 非依存 |
| breeding | `scoreBreeding` ([L335-343](../../keiba-app/lib/score/calculator.ts#L335-L343)) | `horse.breedingFitness` | 非依存 |
| weightChange | `scoreWeightChange` ([L252-260](../../keiba-app/lib/score/calculator.ts#L252-L260)) | `horse.weightDiff` | 非依存 |
| jockey | `scoreJockeyFromRates` ([L352-384](../../keiba-app/lib/score/calculator.ts#L352-L384)) | `jockeyRates` Map (取得時に外部から渡す) | 非依存 |

→ **pastRaces 依存は lastThreeF と courseRecord の2要素**（合計重み 0.442 = 44.2%）。Phase 2H D-1 で `lastThreeF` を pastRaces ベースに切り替えた結果、依存範囲がやや拡大した。

---

## 2. 既存 JSON の保存形式

### サンプル `20260517_202608030812.json`（最新ファイル）の predictions[0]

```jsonc
{
  "horseId": 1,
  "horseName": "...",
  "score": 53.xx,
  "ev": 0.98,
  "odds": 12.3,
  "waku": 1,
  "jockey": "川須",           // ← 2026-04-24 以降のファイルのみ
  "components": {              // ← 全要素の素点（0〜100）が保存されている
    "lastThreeF":   91.67,
    "training":     91.67,     // ← lastThreeF と完全同一値
    "courseRecord": 50,        // ← 50 固定
    "prevClass":    50,        // ← 50 固定
    "breeding":     50,        // ← 50 固定
    "weightChange": 70,
    "jockey":       50
  }
  // pastRaces はキー自体が存在しない
}
```

### 全 3,557 ファイル統計（合計 49,033 頭）

```
lastThreeF === training の馬: 49,033 (100.0%)   ← 全件で同一値
courseRecord === 50 の馬:    49,033 (100.0%)   ← 全件で 50 固定
prevClass    === 50 の馬:    49,033 (100.0%)   ← 全件で 50 固定
breeding     === 50 の馬:    49,033 (100.0%)   ← 全件で 50 固定
jockey       === 50 の馬:     4,571 (  9.3%)   ← 9.3% だけ取得失敗

各要素の distinct な値数（ばらつき指標）:
  lastThreeF:    97 種類    ← 動的算出されている (training と同一)
  weightChange:  6 種類 [30, 50, 70, 85, 95, 100]   ← 段階離散
  prevClass:     1 種類     ← 50 のみ（フォールバック）
  breeding:      1 種類     ← 50 のみ（フォールバック）
  jockey:        976 種類   ← 動的算出されている (騎手勝率由来)

pastRaces キー保有ファイル数: 0 / 3,557
```

### 各要素の状態解釈

| 要素 | 保存状態 | 重み | 説明 |
|---|---|---|---|
| `lastThreeF` | 🟡 値あり・training と同一 | 0.244 | D-1 以前のロジック（旧 `scoreLastThreeF` = `scoreTraining` 兼用）由来。独立化前の値が保存されている |
| `training` | 🟡 同上 | 0.125 | lastThreeF と完全同一値 |
| `courseRecord` | 🔴 全件 50 | 0.198 | Phase 1-D 未実装時 (`return 50;`) の値が保存されている |
| `prevClass` | 🔴 全件 50 | 0.146 | `prevRaceName` が出馬表からほぼ取得できていない or `classifyPrevRace` がフォールバック値返却。スクレイパー側に課題 |
| `breeding` | 🔴 全件 50 | 0.158 | 週次スクレイプは `DISABLE_SIRE=true` で運用しているため、`breedingFitness` が常に未取得 → 全馬 50 |
| `weightChange` | 🟢 動的 | 0.071 | 6段階離散値で正常分布。`horse.weightDiff` から `scoreWeightChange` で算出された値が保存 |
| `jockey` | 🟢 動的 | 0.058 | 976 種類のばらつき。9.3% は騎手勝率取得失敗（地方/外国人/新人騎手）でフォールバック 50、残りは動的 |

→ **動的に意味あるばらつきを持つのは weightChange と jockey の2要素のみ**（合計重み 0.129 = 12.9%）。lastThreeF/training は同一値で実質1指標扱い。

---

## 3. WEIGHTS 探索可能範囲の判定

### ケース判定

> ケース1: components に全要素のスコア値が保存されている → 全要素再配分可能

→ ❌ **不適用**。値は保存されているが、3要素 (`courseRecord` / `prevClass` / `breeding`) が全件 50 固定で再配分の効果がゼロ、さらに `lastThreeF` と `training` が完全同一値のため重み配分を変えても出力スコアに差が出ない。

> ケース2: 一部要素はスコア値も未保存 → 該当要素を含む WEIGHTS 探索は不可、それ以外で探索する

→ 🟡 **限定的に該当**。以下の条件で「数値上は探索可能」だが意味は乏しい：
- 動的要素 (weightChange, jockey) の重みを動かす → スコアに変化あり
- 静的要素 (courseRecord, prevClass, breeding) の重みを動かしても出力スコアに差は出ない（定数 × 重み変更）
- 同一値要素 (lastThreeF/training) は重み合計 `0.244 + 0.125 = 0.369` をどう割っても出力同じ

実質的に探索できるのは **「weightChange と jockey の重み比、+それ以外の重み合計をどう配るか」** の2自由度のみ。残り5要素は実質定数項として固定される。

> ケース3: 完全に再スコアリングが必要 → 計算量見積もり

→ 🔴 **これも実質不可能**。再スコアリングに必要な入力が JSON に保存されていない：
- `lastThreeF`（新ロジック）には `pastRaces` が必要 → 全 3,557 件で未保存
- `courseRecord` には `pastRaces` + `race.raceDate` が必要 → 同上
- `prevClass` には `prevRaceName` または `prevRaceClass` が必要 → JSON に保存なし
- `breeding` には `breedingFitness` (父馬連対率) が必要 → JSON に保存なし（週次スクレイプは `DISABLE_SIRE=true`）

オフラインで再スコアリングするには、`fetchRaceData` を再実行して `horse.pastRaces` / `horse.prevRaceName` / `horse.breedingFitness` を取り直す必要があり、これは事実上の全件再収集（D-3）と同じ。

### 結論

**既存 3,557 件だけで実行可能な WEIGHTS 探索の範囲**：

| 探索内容 | 可否 | 備考 |
|---|---|---|
| Phase 2H 暫定（lastThreeF 独立化 + courseRecord 実装）後の重み再最適化 | 🔴 不可 | 動的に動く独立指標が weightChange/jockey の 2 つしかない |
| 旧ロジック（Phase 2E Stage 3 時点）の重み再配分 | 🟡 形式的には可能 | 既に同等手法で最適化済み（Stage 3 で 93.05% 達成）。再走しても新発見は期待薄 |
| weightChange と jockey の重み感度分析のみ | 🟢 可能 | 重み 0.129 部分のみ動かす狭い探索 |

---

## 4. 不足要素と補完方針

### 何が足りないか
- `predictions[].pastRaces` （0/3,557 件）→ D-1 改修済、次回火曜 (2026-05-26) の週次スクレイプから新規分のみ保存される
- `predictions[].prevRaceName` または `prevRaceClass` （未定義）→ スクレイパーは `horse.prevRaceName` を持つが、`buildVerificationData` が保存していない
- `predictions[].breedingFitness` または `father` （未定義）→ 週次スクレイプ `DISABLE_SIRE=true` のため、そもそも取得していない
- `predictions[].weightDiff` （未保存）→ `components.weightChange` (段階離散値) しか残らない。weightDiff 生値があれば re-scoring 可能

### 補完方針（推奨順）

| # | 方針 | 実装コスト | 効果 | 備考 |
|---|---|---|---|---|
| 1 | **D-2 観察待ち**: 次回火曜 (5-26) 以降の週次スクレイプで新規分が pastRaces 込みで蓄積されるのを待つ | ゼロ | 1-2週で 50-100R / 月 200-300R 程度 | 単純に時間待ち。Phase 2H-C 着手は 2-3ヶ月先 |
| 2 | **collect-verification.ts に prevRaceName / weightDiff の保存を追加**（D-1 同様の型同期改修）| 軽 (型 + 1-2行) | re-scoring に必要な生データを保存 | 次回 5-26 のスクレイプから反映 |
| 3 | **D-3 専用バッチで既存3,557件を pastRaces+sire 込みで再収集**（前回設計で提案済） | 重（200000 req 規模、ローカル20日分割）| 既存全件を新ロジックで再評価可能 | 事故リスク高、人手介入必須 |
| 4 | `DISABLE_SIRE=false` で運用切替 | 中（HTTP 負荷増） | breeding 要素が活きる | 取得失敗率も検証要 |

### Phase 2H-C 着手判断

現状で着手すると「動的に動かせる重みが weightChange/jockey の 0.129 部分だけ」という制約があり、得られる結論は限定的。**最低でも以下を満たすまで Phase 2H-C は待つべき**：

1. pastRaces 込みの新形式データが 1,000R 以上蓄積されている（≈ 3-4 ヶ月後 or D-3 実施後）
2. `prevRaceName` / `weightDiff` 等の生データも JSON に保存されている（補完方針 #2 の改修後）

---

## 5. 副次発見

調査中に以下も確認できた（本タスクの直接スコープ外だが報告）：

- **`predictions[].jockey`** は `2026-04-24` 以降のファイルのみ含まれる（古いファイルでは `undefined`）。これは [collect-verification.ts:256](../../keiba-app/scripts/collect-verification.ts#L256) のコメント通りの挙動
- **`waku`** は新旧両方のファイルに含まれている
- **`pastRaces` 保有ファイル数 = 0**: D-1 のコミット `a9b973d` (2026-05-19) 以降の週次スクレイプは**まだ1回も走っていない**（次回火曜 5-26 が初回）

---

## 6. 推奨次アクション

1. **本タスクは下調べで終了**（実装着手なし）
2. 次回火曜 (2026-05-26) の週次スクレイプ実行後に **D-2 観察フェーズ**: pastRaces 込み JSON が想定通り保存されているか目視確認
3. 並行して **補完方針 #2** (`prevRaceName` / `weightDiff` 保存) を別タスクで検討。これは D-1 と同様の軽い型同期で済む
4. Phase 2H-C 本格着手は「pastRaces 付き 1,000R 以上」「prevRaceName/weightDiff 保存済み」の両方が揃ってから

以上。
