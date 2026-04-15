# スクレイパー仕様

## スクレイピング対象URL

| 取得内容     | URL                                                              |
|--------------|------------------------------------------------------------------|
| 出馬表       | `https://race.netkeiba.com/race/shutuba.html?race_id={raceId}`  |
| 単複オッズ   | `https://race.netkeiba.com/odds/index.html?race_id={raceId}`    |
| 調教タイム   | `https://race.netkeiba.com/race/oikiri.html?race_id={raceId}`   |
| 前走成績     | `https://db.netkeiba.com/horse/{horseId}/`                      |

---

## 取得項目と型

```typescript
// 出馬表から取得
horse.id          // 馬番（1〜18）
horse.name        // 馬名
horse.waku        // 枠番（1〜8）
horse.jockey      // 騎手名
horse.trainer     // 調教師名
horse.weight      // 馬体重（kg）
horse.weightDiff  // 馬体重増減（前走比）

// オッズページから取得
horse.odds        // 単勝オッズ
horse.fukuOddsMin // 複勝オッズ下限
horse.fukuOddsMax // 複勝オッズ上限

// 調教ページから取得
horse.lastThreeF  // 最終追い切りラスト1F（秒）

// 前走成績ページから取得（将来対応）
horse.pastResults // 過去成績配列
```

---

## セレクタ管理方針

### 原則
- クラス名は変更されやすいため、**構造ベース**のセレクタを優先する
- セレクタを変更したときは必ずこのファイルに変更理由を記録する

### 現在のセレクタ（最終更新: 2026-04-15）

```typescript
// 出馬表（確定モード: shutuba.html）
const SELECTORS = {
  horseRow:    'tr.HorseList',
  horseNumber: 'td[class^="Umaban"]', // "Umaban1", "Umaban2" に対応
  waku:        'td[class^="Waku"]',   // "Waku1", "Waku2" に対応
  horseName:   'td.HorseInfo',        // リンクではなくtd直接
  jockey:      'td.Jockey',
  trainer:     'td.Trainer',
  weight:      'td.Weight',
};

// オッズ: HTMLではなくJSON APIを使用（2026-04-15 調査確定）
// GET https://race.netkeiba.com/api/api_get_jra_odds.html?type=1&race_id={raceId}&action=init
// type=1: 単勝 → data.odds["1"]["01"] = [odds, "", rank]
// type=2: 複勝 → data.odds["2"]["01"] = [min, max, rank]
//
// ⚠️ 重要: action=init パラメーターが必須
//   付けない → status="middle"（データなし）
//   付ける   → status="yoso"（予想オッズ）or status="result"（確定オッズ）
//
// yoso時のキー形式: 登録番号（ゼロ埋めなし整数）= shutuba_past.html の tr_N の N と一致
// result時のキー形式: 馬番（ゼロ埋め2桁）"01"〜"18"
// どちらも parseInt でパース可能

// 調教: oikiriページに数値タイムなし。評価テキスト→近似秒数に変換
const TRAINING_SELECTORS = {
  row:     'tr.HorseList',
  horseNum: 'td.Umaban',
  critic:  'td.Training_Critic', // "手応勝る", "キビキビ" 等
};
```

### スケジュールページ（race_list_sub.html）（最終確認: 2026-04-14）

※ race_list.html はJS SPAのためaxiosでは取得不可。race_list_sub.html（SSR・UTF-8）を使用する。

```typescript
// スクレイピングURL（race_list.html → race_list_sub.html に変更）
// GET https://race.netkeiba.com/top/race_list_sub.html?kaisai_date={date}
// エンコーディング: UTF-8（responseType: 'text'で取得）

// DOM構造:
// dl.RaceList_DataList
//   dt.RaceList_DataHeader （競馬場ブロックヘッダ）
//     p.RaceList_DataTitle  → "3回 中山 7日目" (競馬場名を含む)
//   dd.RaceList_Data
//     ul > li.RaceList_DataItem （レース行）

// 競馬場ブロック
const headerEl  = '.RaceList_DataHeader';
const titleEl   = '.RaceList_DataTitle';   // テキストに競馬場名が含まれる

// レース行（.RaceList_DataHeader の次の dd.RaceList_Data 配下）
const itemEl    = '.RaceList_DataItem';

// 各レース行内の要素
const raceNum   = '.Race_Num span';        // "9R", "12R" （MyRaceCheckのspanを除く最初のspan）
const startTime = '.RaceList_Itemtime';    // "14:25"
const raceName  = '.ItemTitle';            // "袖ケ浦特別"（.RaceList_ItemTitle内）
const headCount = '.RaceList_Itemnumber';  // "14頭"
const gradeIcon = '[class*="Icon_GradeType"]'; // G1=GradeType1, G2=2, G3=3, L=5, OP=15/16
const raceIdHref = 'a[href*="race_id="]'; // href から race_id= の12桁を抽出
```

### セレクタが壊れた場合の対処
1. ブラウザのDevToolsで実際のHTMLを確認する
2. 新しいセレクタをここに記録する
3. 変更日とコメントを残す

---

## レート制限とエラー処理

```typescript
// 必ず守ること
const SCRAPE_INTERVAL_MS = Number(process.env.SCRAPE_INTERVAL_MS ?? 1000);

// リトライ設定
const RETRY_COUNT = 2;
const RETRY_INTERVAL_MS = 500;

// User-Agent（ブラウザになりすます）
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36';
```

### エラー時の挙動
- ネットワークエラー → リトライ後に失敗したらnullを返す
- パースエラー → 該当フィールドを0にして処理継続
- 全フィールド取得失敗 → USE_MOCKのモックデータにフォールバック

---

## モックデータ仕様

`USE_MOCK=true` のとき返すデータは 2026年NZT（raceId: 202606030511）の実データ。
モックデータは `lib/scraper/__mocks__/202606030511.ts` に定義する。

モックデータに含める馬（全15頭）:
1番ハノハノ、2番マダックス、3番レザベーション、4番ヒズマスターピース、
5番ジーネキング、6番シュペルリング、7番ロデオドライブ、8番スマイルカーブ、
9番ブルズアイプリンス、10番ジーティーシンドウ、11番ゴーラッキー、
12番アルデトップガン、13番ガリレア、14番ディールメーカー、15番ミリオンクラウン

オッズはスポーツナビ中間オッズ（2026-04-10 19:46）を使用。
