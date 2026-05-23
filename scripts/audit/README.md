# verification データ品質監査 (audit)

「スコア5要素が全件50固定で数ヶ月放置」事件 (2026-05-23 発覚) の再発防止のため、
verification JSON の異常分布を継続的に検知する仕組み。

## ファイル構成

```
scripts/audit/
├── run_audit.ts       # 監査本体 (フェーズ1: AUD-1〜4)
├── reports/           # 週次レポート (YYYYMMDD 付き Markdown + JSON)
└── README.md          # このファイル
```

## 実行

### ローカル手動
```bash
pnpm tsx scripts/audit/run_audit.ts
```

### GitHub Actions (自動)
`.github/workflows/audit.yml` が毎週水曜 09:00 JST に実行 (週次スクレイプ翌日)。
`scripts/audit/reports/` 配下にレポートを蓄積し、main にコミット push。

## 監査項目 (フェーズ1)

| ID | 内容 |
|---|---|
| AUD-1 | components 各要素の distinct 値数。3 未満で ERROR |
| AUD-2 | components 各要素の 50 占有率。80% 以上で ERROR |
| AUD-3 | lastThreeF === training の馬の割合 (Phase 2H D-1 以前の旧ロジック残存検知) |
| AUD-4 | pastRaces 保存率 |

詳細仕様: [docs/proposals/2026-05-23-audit-system-design.md](../../docs/proposals/2026-05-23-audit-system-design.md)

## 異常検出時の挙動

- ERROR が1件以上 → `process.exit(1)` で CI 失敗扱い (Actions ダッシュボードで赤くなる)
- WARNING / NOTICE のみ → 0 で正常終了
- GitHub Actions ログには `::error::` `::warning::` `::notice::` の annotation 出力

## 閾値の調整

`run_audit.ts` 冒頭の定数 (`DISTINCT_ERROR` 等) は仮置きの値。運用後にトレンドを見て調整する。
今は「直近で発覚した事件を確実に検知できる」レベルに設定。

## フェーズ2 以降の予定

- AUD-5: スコア分布の窓比較 (中央値・最大・最小の急変)
- AUD-6: EV 中央値の健全性 (期待 0.85〜1.10)
- AUD-7: 新規収集 R 数の推移
- AUD-8: スクレイパー HTTP エラー集計

詳細: [docs/proposals/2026-05-23-audit-system-design.md](../../docs/proposals/2026-05-23-audit-system-design.md) Section 4
