# prevClass 全件50固定の根本原因調査

| 項目 | 値 |
|---|---|
| 調査日 | 2026-05-23 |
| 発端 | feasibility 調査で「`predictions[].components.prevClass` が全49,033頭で 50 固定」を発見 |
| 結論 | 🔴 **主原因: スクレイパーが `prevRaceName` を取得できていない**（仮説A 確定）／🔴 **副次バグ: `classifyPrevRace` の正規化に英大文字 I の不変換** |
| 修正範囲 | スクレイパー側 1〜2箇所 + classifyPrevRace 1行 |
| 遡及適用 | 🟡 限定的可（pastRaces[1].raceName を疑似前走として使えば近似可能、ただし pastRaces 自体が全件未保存） |

---

## 1. classifyPrevRace の挙動確認

### 関数の場所
[lib/score/calculator.ts:351-380](../../keiba-app/lib/score/calculator.ts#L351-L380)

```typescript
export function classifyPrevRace(name: string): number {
  if (!name) return 50; // ← (a) 空文字なら 50

  const n = name
    .replace(/[ＧｇGg]/g, 'G')
    .replace(/[Ⅰ１]/g, '1')   // ← (b) ローマ数字 Ⅰ と全角 １ は変換するが、英大文字 I (U+0049) は未対応
    .replace(/[Ⅱ２]/g, '2')   // ← (c) 同上 (II は未対応)
    .replace(/[Ⅲ３]/g, '3');  // ← (d) 同上 (III は未対応)

  // グレード競走
  if (/G1/.test(n)) return 100;
  if (/G2/.test(n)) return 85;
  if (/G3/.test(n)) return 70;

  // リステッド
  if (/\(L\)|\[L\]|リステッド/i.test(n)) return 60;

  // オープン特別
  if (/オープン|OP/.test(n)) return 55;

  // 条件戦 (新旧両表記に対応)
  if (/3勝|1600万/.test(n)) return 50;  // ← (e) 3勝クラスも 50 を返す！(中立値と区別不能)
  if (/2勝|1000万/.test(n)) return 40;
  if (/1勝|500万/.test(n)) return 30;
  if (/未勝利/.test(n)) return 20;
  if (/新馬/.test(n)) return 15;

  // 不明（地方交流・海外等）: やや低めで返す
  return 35; // ← (f) どれにも該当しない場合 35
}
```

### 「50 を返す分岐」一覧

| # | 条件 | 戻り値 | 想定 |
|---|---|---|---|
| (a) | name が空文字 / undefined | 50 | フォールバック |
| (e) | `3勝` / `1600万` パターン | 50 | 3勝クラス（条件戦の最上位） |

→ 50 を返す経路は **(a) と (e) のみ**。

### scorePrevClass の経路
[lib/score/calculator.ts:389-393](../../keiba-app/lib/score/calculator.ts#L389-L393)

```typescript
function scorePrevClass(horse: Horse): number {
  if (typeof horse.prevRaceClass === 'number') return horse.prevRaceClass;
  if (horse.prevRaceName) return classifyPrevRace(horse.prevRaceName);
  return 50; // ← どちらも未定義の場合
}
```

→ 50 が返るのは：
1. `prevRaceClass` が数値で **値が 50**
2. `prevRaceName` が truthy で classifyPrevRace が 50 を返す（上記 (a)/(e)）
3. 両方 undefined のフォールバック

---

## 2. 入力データの実態確認

### スクレイパー側のロジック
[lib/scraper/netkeiba.ts:315-329](../../keiba-app/lib/scraper/netkeiba.ts#L315-L329)

```typescript
// 前走レース名: HorseList 行内で href="...race_id=XXXXXXXXXXXX" となっている
//   a タグのテキストを前走名として採用 (当該レース自身の race_id は除外)
//   最初にヒットしたものが直近の前走
let prevRaceName: string | undefined;
$(row).find('a[href*="race_id="]').each((_j, el) => {
  if (prevRaceName) return;
  const href = $(el).attr('href') ?? '';
  const m = href.match(/race_id=(\d{12})/);
  if (!m) return;
  if (m[1] === raceId) return; // 自レースへのリンクはスキップ
  const txt = $(el).text().trim();
  if (txt && !/^\d+$/.test(txt)) prevRaceName = txt; // 数字だけのリンクは除外
});

horseMap.set(id, { ..., prevRaceName, horseId });
```

そして [L527-529](../../keiba-app/lib/scraper/netkeiba.ts#L527-L529):

```typescript
horses.push({
  ...card,
  prevRaceClass: card.prevRaceName ? classifyPrevRace(card.prevRaceName) : undefined,
  ...
});
```

→ **prevRaceName が空 ⇒ prevRaceClass も undefined**。両方 undefined になるのは scraper が prevRaceName を取れなかったケースのみ。

### verification JSON に prevRaceName 未保存
`collect-verification.ts:246-257` で `predictions` に書き込まれるフィールドに `prevRaceName` が**含まれていない**。`components.prevClass` の値だけが保存される（feasibility 調査で確認済）。

→ 既存 JSON 単独では生 prevRaceName を確認できない。

### pastRaces[1].raceName を擬似前走としてサンプル100件確認
production_verification_20260511.json（D-1 で取得した 2レース 29頭）から、`pastRaces` の上位を `classifyPrevRace` に通して挙動を観測（pastRaces[0] は自レース当日のことが多いので、実質前走は [1]）。

#### 観測結果

```
=== 202608030212 4歳以上2勝クラス (平場) ===
馬1: "4歳以上2勝クラス" → 40 (2勝)
馬2: "4歳以上1勝クラス" → 30 (1勝)
馬3: "4歳以上1勝クラス" → 30
馬4: "4歳以上2勝クラス" → 40
馬5: "4歳以上2勝クラス" → 40

=== 202508020411 天皇賞(春) G1 (重賞) ===
馬1 アラタ:           "東海テレビ杯金鯱賞(GII)" → 35 ← 🔴 G2 のはずが「不明」扱い
                     "有馬記念(GI)"            → 35 ← 🔴 G1 のはずが「不明」扱い
馬2 ウインエアフォルク: "古都S(3勝クラス)"        → 50 (3勝)
                     "天皇賞(春)(GI)"          → 35 ← 🔴
                     "阪神大賞典(GII)"         → 35 ← 🔴
馬3 ブローザホーン:    "天皇賞(春)(GI)"          → 35 ← 🔴
                     "阪神大賞典(GII)"         → 35 ← 🔴
馬4 ジャンカズマ:     "ダイヤモンドS(GIII)"      → 35 ← 🔴
                     "万葉S(OP)"               → 55 (OP)
馬5 サンライズアース:  "ジャパンC(GI)"           → 35 ← 🔴
```

#### 発見1: classifyPrevRace の英大文字 I バグ（副次）

netkeiba の表記は `(GI)` `(GII)` `(GIII)` に **英大文字 I (U+0049)** を使う。一方 classifyPrevRace の正規化は **ローマ数字 Ⅰ Ⅱ Ⅲ (U+2160-U+2162) と全角 １ ２ ３** のみ対応。

```typescript
.replace(/[Ⅰ１]/g, '1')   // Ⅰ と １ → 1。 英大文字 I は対象外
```

→ `(GI)` → 変換後も `(GI)` → `/G1/` にマッチせず → 全分岐スルーで **35 (不明)** を返す。

これは「もし prevRaceName が取れていたら」**全 G1/G2/G3 重賞勢が 35 になる**バグ。現状は別バグ（仮説A）でマスクされていて表面化していなかった。

#### 発見2: 平場は分類できる（normalで動作）

`4歳以上2勝クラス` → 40、`1勝クラス` → 30 など、条件戦は正常分類。**classifyPrevRace 自体は半分は動く**（条件戦のみ）。

---

## 3. 仮説検証

### 仮説A: prevRaceName が空 → スクレイパーが取得失敗

**論理的に確定**できる：

1. `verification JSON` の全49,033頭で `components.prevClass === 50`
2. `scorePrevClass` で 50 を返す唯一の経路は「prevRaceClass undefined かつ prevRaceName 空」
3. `netkeiba.ts:L529` で `prevRaceClass` は `prevRaceName ? classifyPrevRace(...) : undefined` で構築
4. もし `prevRaceName` が取れていれば、平場（2勝クラスなど）は **40** を返すはず、重賞は副次バグで **35** を返すはず
5. 全件 50 ということは、**全件で prevRaceName が空**

🔴 **仮説A 確定**。

### 仮説B: prevRaceName は取れているが、分類関数のパターンマッチが壊れている

→ ❌ 否定。もし取れていたら、平場では 40/30/20 のいずれかが返り、50 にはならない（3勝クラスを除き）。3勝クラスのみが全49,033頭分とは統計的にあり得ない。

### 仮説C: そもそも prevClass の計算経路が呼ばれていない（dead code）

→ ❌ 否定。`calcAllComponentScores` の中で `prevClass: scorePrevClass(horse)` が呼ばれており、その結果が `predictions[].components.prevClass` に保存されている。呼ばれていないなら キー自体が存在しないはずだが、実 JSON では値 50 が入っている。

### 仮説D: 別の要因

→ 副次的に `classifyPrevRace` 自体の英大文字 I バグを発見（発見1）。これは仮説A 解消後に表面化するため、修正フェーズで併せて直す必要がある。

---

## 4. breeding 全件50 の経路再確認（実行なし）

### 経路
[lib/scraper/netkeiba.ts:486-498](../../keiba-app/lib/scraper/netkeiba.ts#L486-L498):

```typescript
let sireMap: SireStatsByHorseNum = new Map();
if (process.env.DISABLE_SIRE !== 'true') {
  try {
    const horsesForSire = Array.from(cardResult.horseMap.values())
      .map((h) => ({ id: h.id, horseId: h.horseId }));
    sireMap = await fetchSireStatsForHorses(horsesForSire);
  } catch (e) {
    console.warn('[scraper] 血統統計取得失敗 (スキップ):', e);
  }
}
```

→ `DISABLE_SIRE=true` 時は **sireMap が空のまま**。

[L532-537](../../keiba-app/lib/scraper/netkeiba.ts#L532-L537):
```typescript
let breedingFitness: number | undefined;
if (sire?.stats) {
  const courseKey = ...;
  const cell = sire.stats[courseKey][raceBand];
  if (cell && cell.samples > 0) breedingFitness = cell.placeRate;
}
```

→ sireMap が空なら **全馬で `breedingFitness = undefined`**。

そして `scoreBreeding` [L404-415](../../keiba-app/lib/score/calculator.ts#L404-L415):
```typescript
export function scoreBreeding(allHorses: Horse[]): number[] {
  const raw = allHorses.map((h) => h.breedingFitness ?? -1);
  const known = raw.filter((v) => v >= 0);
  if (known.length === 0) return allHorses.map(() => 50);
  ...
}
```

→ 全馬 `breedingFitness=undefined` → `known.length === 0` → **全員 50 を返す**。

### 結論（breeding）

- 既存運用 `DISABLE_SIRE=true` (`.github/workflows/weekly-scrape.yml:50`) が原因
- コード経路は健全。`DISABLE_SIRE=false` にすれば動く設計
- 実行時 HTTP 負荷が増える（馬個別ページ + 父馬sireページの2層取得）ため、運用切替には別途検討が必要

---

## 5. 修正に必要な作業見積もり

### 主原因: prevRaceName 取得失敗（仮説A）

**コード変更だけで済むか**: ❓ **不明**。スクレイパーの取得経路（`a[href*="race_id="]`）が現状の netkeiba HTML 構造でヒットしない可能性が高いが、現状を直接確認するには **実 netkeiba 1リクエスト** が必要。下調べフェーズでは saberたず、修正フェーズで実 HTML を見てセレクタを直す。

候補となる修正案:
1. **セレクタ見直し**: 出馬表 `tr.HorseList` 内の前走情報を別経路で取る（例: `td.Jra` 配下や `td.RaceInfo` 等、netkeiba の現行レイアウト調査必須）
2. **shutuba_past.html 併用**: Phase 2H で取得実績のある shutuba_past の「過去走付き出馬表」から prevRaceName を抜く（既に過去5走分の構造を把握済）
3. **horse_history (pastRaces) から導出**: `horse.pastRaces[0]` が自レース当日でなければそれを前走として使う（pastRaces 自体は D-1 改修で取得済）

→ **推奨は #3**: 既に D-1 で pastRaces を取得しているため、新規 HTTP なし。`scorePrevClass` を「prevRaceClass → prevRaceName → **pastRaces[0]** (タイムリーキ防止で baseDate < ) → 50」のフォールバック順に変えるだけ。コード変更は数行。

### 副次バグ: classifyPrevRace の英大文字 I 不変換

```typescript
const n = name
  .replace(/[ＧｇGg]/g, 'G')
  .replace(/[Ⅰ１]/g, '1')
  .replace(/[Ⅱ２]/g, '2')
  .replace(/[Ⅲ３]/g, '3')
  // ↓ 追加候補:
  .replace(/G(III)\b/g, 'G3')   // 英大文字 III → 3
  .replace(/G(II)\b/g, 'G2')    // II → 2
  .replace(/G(I)\b/g, 'G1');    // I → 1
```

→ **正規表現1行 + 単体テストで完結**。修正コスト: 数分〜10分。

### 工数概算

| 修正 | コード変更 | テスト | 影響範囲確認 | 合計 |
|---|---|---|---|---|
| classifyPrevRace I バグ | 1行 | 既存 `test-score.ts` に重賞ケース追加 | 軽 | 30分 |
| scorePrevClass を pastRaces フォールバック化 | 5-10行 | 既存テスト + smoke test | 中（calcAllScores 全経路） | 1-2時間 |
| 上記の影響度確認（pastRaces 込みのレースで再計算） | 0 | verify_production_run.ts 再実行 | 中 | 30分 |

合計 **半日程度**。実 netkeiba 1リクエストはセレクタ実態確認のために発生する可能性あり。

---

## 6. 既存3,557R への遡及適用可否

### 結論
🟡 **限定的に可能。ただし pastRaces 全件未保存のため即時遡及は不可**。

### 詳細
- 遡及計算には **生の prevRaceName** か **pastRaces[1]** が必要
- 既存 verification JSON は **両方とも未保存**（components.prevClass の数値結果のみ）
- D-2 観察フェーズ (次回火曜 5-26 以降) で **新規収集分は pastRaces 込み**になり、遡及計算可能
- D-3（全件再収集）を実施すれば 3,557 件全件が pastRaces 込みになり、完全遡及可能

### 遡及計算のロジック（pastRaces ありの場合）

```typescript
// 疑似コード
function recomputePrevClass(horse: Horse, baseDate: Date): number {
  // pastRaces を baseDate より前で抽出
  const past = (horse.pastRaces ?? [])
    .filter((p) => parseHistoryDate(p.date)! < baseDate)
    .sort(byDateDesc)[0];
  if (!past) return 50;
  return classifyPrevRace(past.raceName);
}
```

→ タイムリーキ防止は `parseHistoryDate < baseDate` で機能。

---

## 7. breeding 復活の前提条件

| 条件 | 状態 | 備考 |
|---|---|---|
| `DISABLE_SIRE` を false にする | 🔴 未対応 | `.github/workflows/weekly-scrape.yml:50` を変更すれば即対応可 |
| sireMap 取得の HTTP 負荷を許容 | 🟡 要検討 | 18頭 × 2層 (horse + sire) = 約36 req/レース 増加。週次30-70Rで 1000-2500 req/週 増加 |
| sire selector の動作確認 | 🟡 未確認 | `lib/scraper/sire.ts` の selector が現行 netkeiba で機能するか実取得して確認必要 |
| 取得失敗時のフォールバック動作 | 🟢 既に実装済 | `scoreBreeding` の `known.length === 0` 経路で 50 を返す |

→ **コード経路は健全、運用切替の問題**。実 HTTP 負荷増を許容できるなら 1コミットで復活可能。事故リスク再評価が必要。

---

## 8. 推奨次アクション

### 短期（1-2日）
1. **修正フェーズ着手**（マー君判断）：
   - classifyPrevRace の英大文字 I 修正（30分タスク）
   - scorePrevClass の pastRaces フォールバック追加（半日タスク）
2. 修正後に **D-2 観察待ち**: 5-26 火曜の週次スクレイプで新形式 (pastRaces 込み) のレースに対し prevClass が正しく算出されるか確認

### 中期（数週〜数ヶ月）
3. **breeding 復活の判断**: DISABLE_SIRE=false にする際の HTTP 負荷増を許容するか。週次スクレイプの所要時間が現状の倍程度になる見込み
4. **D-3 (全件再収集)**: 3,557R 全件を pastRaces 込みで再収集する判断（事故リスクあり、別タスクで設計）

### 後追い
5. `predictions[].prevRaceName` を JSON に保存する型同期改修（D-1 同様の軽い変更）→ 将来のオフライン再計算を容易に

以上。
