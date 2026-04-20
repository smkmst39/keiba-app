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
// GET https://race.netkeiba.com/api/api_get_jra_odds.html?type={N}&race_id={raceId}&action=init
// type=1: 単勝   → data.odds["1"]["01"] = [odds, "", rank]
// type=2: 複勝   → data.odds["2"]["01"] = [min, max, rank]
// type=3: 枠連   → data.odds["3"]["12"] = [odds, "", rank]   ← キーは1桁+1桁
// type=4: 馬連   → data.odds["4"]["0102"] = [odds, "", rank] ← キーはゼロ埋め2桁×2
// type=5: 馬単   → data.odds["5"]["0102"] = [odds, "", rank]
// type=6: ワイド → data.odds["6"]["0102"] = [下限, 上限, rank]
// type=7: 三連複 → data.odds["7"]["010203"] = [odds, "", rank]
// type=8: 三連単 → data.odds["8"]["010203"] = [odds, "", rank]
//
// ⚠️ 重要: action=init パラメーターが全typeで必須
//   付けない → status="middle"かつdata.oddsが空 or 文字列（データなし）
//   付ける   → data.oddsにデータあり（statusが"middle"でもデータは取れる場合あり）
//
// キー形式: ゼロ埋め馬番の連結（type=3のみ1桁ずつ）
// parsePairKey / parseTripleKey / parseWakuKey で "1-2" / "1-2-3" 形式に変換

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

## スクレイピングのレート制限対策

### 必須ルール
1. アクセス間隔は最低1.5秒（推奨2秒）
2. 連続アクセスは30分以内にする
3. 30分ごとに5分の休憩を入れる
4. 100レース以上の一括処理時は並列数を1に制限
5. 403/400エラー時は60秒待機してから1回のみリトライ

### エラー時の挙動
- HTTP 400/403が返ったら即座に停止
- ブロックされた場合は最低3時間待機
- User-Agentは固定（ランダム化しない）
- エラー発生時は詳細ログを出力

### 大規模収集時のガイドライン
500レース超の収集は以下の制約を守ること:
- 複数日に分割実行（1日200レース以内）
- 深夜帯（2-6時）は実行しない
- 実行前に利用規約を再確認
- 収集完了後は必ず24時間の間隔を空けて次の処理

### 過去の事故
2026年4月19日: 795レース収集後HTTP 400ブロック発生
→ 原因: 65分連続アクセス
→ 対策: 30分ごとに5分休憩を必須化

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
