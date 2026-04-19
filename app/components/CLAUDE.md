# UIコンポーネント仕様

## 枠色定義（JRA標準）

```typescript
export const WAKU_COLORS: Record = {
  1: { bg: '#ffffff', border: '#aaaaaa', text: '#333333', label: '白' },
  2: { bg: '#111111', border: '#111111', text: '#ffffff', label: '黒' },
  3: { bg: '#e8352a', border: '#c0281f', text: '#ffffff', label: '赤' },
  4: { bg: '#4fa3db', border: '#2d87c4', text: '#ffffff', label: '青' },
  5: { bg: '#f5d800', border: '#d4b800', text: '#333333', label: '黄' },
  6: { bg: '#159c4a', border: '#0d7438', text: '#ffffff', label: '緑' },
  7: { bg: '#f08010', border: '#c86400', text: '#ffffff', label: '橙' },
  8: { bg: '#ec77ae', border: '#d05590', text: '#ffffff', label: '桃' },
} as const;
// この色定義は変更禁止（JRA公式標準色）
```

---

## 券種ごとの軸数と選択仕様

| 券種   | 軸(A列)      | B列        | C列        | 組み合わせ生成方法               |
|--------|--------------|------------|------------|----------------------------------|
| 単勝   | 1頭（単選択）| -          | -          | A列の馬をそのまま1点ずつ         |
| 複勝   | 1頭（単選択）| -          | -          | 同上                             |
| 枠連   | 軸枠（複数可）| 相手枠    | -          | A×B の枠番ペア（重複排除・順不同）|
| 馬連   | 軸馬（複数可）| 相手馬    | -          | A×B の馬番ペア（重複排除・順不同）|
| ワイド | 軸馬（複数可）| 相手馬    | -          | 同上                             |
| 馬単   | 1着馬（複数可）| 2着馬   | -          | A→B の順序付きペア               |
| 三連複 | 1軸（複数可）| 2軸       | ひも        | A×B×C の3頭組（重複排除・順不同）|
| 三連単 | 1着（複数可）| 2〜3着ひも| 2〜3着ひも | A→B→C の順序付き3頭組           |

---

## 期待値の色分けルール

```typescript
// EVバッジの色（EV_THRESHOLD_BUY = 1.05 を採用。lib/score/calculator.ts で定数化）
ev >= 1.05 → 緑（sg class）  // 買い推奨
ev >= 0.90 → 橙（sm class）  // 要検討
ev <  0.90 → 赤（sb class）  // 非推奨

// カードのボーダー強調
i === 0（最高EV）  → 緑ボーダー + 緑背景
ev >= 1.05（買い） → 青ボーダー + 青背景
ev <  0.6          → opacity: 0.75（薄く表示）
```

---

## スコア（S）・期待値（EV）・オッズ表示の順序

カードには必ず `EV → S → オッズ` の順で表示する。
長期回収を主目的とするため EVを最左に置く。

---

## 自動更新の仕様

```typescript
// オッズ自動更新間隔
const ODDS_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5分

// 発走X分前は間隔を短縮
if (minutesUntilStart <= 30) interval = 60 * 1000;  // 1分
if (minutesUntilStart <= 10) interval = 30 * 1000;  // 30秒

// 更新時の表示
"最終更新: HH:MM:SS" を画面右上に表示
更新中はスピナーを出す
```

---

## コンポーネント一覧と責務

| コンポーネント       | 責務                                       |
|----------------------|--------------------------------------------|
| RaceSelector         | raceId入力・API呼び出し・ローディング表示  |
| BakenSimulator       | 券種タブ・馬選択・組み合わせ一覧表示       |
| HorsePill            | 枠色付き馬選択ボタン（再利用可能）         |
| ComboCard            | EV・スコア・オッズを1枚に表示するカード    |
| OddsRefreshBadge     | 最終更新時刻・自動更新インジケーター       |
