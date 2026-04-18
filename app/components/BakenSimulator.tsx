'use client';

// ==========================================
// 馬券シミュレーターコンポーネント
// 枠色・EV色分けは app/components/CLAUDE.md の定義に従う
// ==========================================

import { useState, useMemo, useEffect } from 'react';
import type { Race, Horse, BetType, ComboOddsData } from '@/lib/scraper/types';
import { useComboOdds } from '@/app/hooks/useComboOdds';
import { calcComboEV } from '@/lib/score/calculator';

// 仮予想モードバナー
// hasOdds=true のとき予想オッズ使用の旨を追加表示
function PreEntryBanner({ hasOdds }: { hasOdds: boolean }) {
  return (
    <div style={{
      background: '#fffbeb',
      border: '1px solid #f6ad55',
      borderRadius: '6px',
      padding: '0.75rem 1rem',
      marginBottom: '1rem',
      fontSize: '0.85rem',
      color: '#744210',
      lineHeight: '1.6',
    }}>
      <strong>⚠️ 枠順確定前のため仮予想モードで表示しています</strong>
      {hasOdds && (
        <div style={{ marginTop: '0.2rem' }}>
          予想オッズを使用した参考値です。枠順確定後に実オッズで更新されます。
        </div>
      )}
      <div style={{ marginTop: '0.2rem' }}>
        現在は単勝の参考予想のみご利用いただけます。
      </div>
      <div style={{
        marginTop: '0.5rem',
        paddingTop: '0.5rem',
        borderTop: '1px solid #f6ad55',
        color: '#92400e',
      }}>
        <strong>📅 枠順確定スケジュール</strong>
        <div style={{ marginTop: '0.2rem', paddingLeft: '0.5rem' }}>
          ・土曜レース → 木曜 17時頃に確定<br />
          ・日曜レース → 金曜 17時頃に確定
        </div>
        <div style={{ marginTop: '0.3rem' }}>
          確定後にページを再読み込みすると全券種が利用可能になります。
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 枠色定義（JRA標準 — 変更禁止）
// ==========================================
const WAKU_COLORS: Record<number, { bg: string; border: string; text: string }> = {
  1: { bg: '#ffffff', border: '#aaaaaa', text: '#333333' },
  2: { bg: '#111111', border: '#111111', text: '#ffffff' },
  3: { bg: '#e8352a', border: '#c0281f', text: '#ffffff' },
  4: { bg: '#4fa3db', border: '#2d87c4', text: '#ffffff' },
  5: { bg: '#f5d800', border: '#d4b800', text: '#333333' },
  6: { bg: '#159c4a', border: '#0d7438', text: '#ffffff' },
  7: { bg: '#f08010', border: '#c86400', text: '#ffffff' },
  8: { bg: '#ec77ae', border: '#d05590', text: '#ffffff' },
};

// ==========================================
// EVバッジ色（app/components/CLAUDE.md 準拠）
// ==========================================
function evBadgeStyle(ev: number): React.CSSProperties {
  if (ev >= 1.0) return { background: '#276749', color: '#fff' }; // 緑 - 買い推奨
  if (ev >= 0.75) return { background: '#c05621', color: '#fff' }; // 橙 - 要検討
  return { background: '#9b2c2c', color: '#fff' };                 // 赤 - 非推奨
}

// ==========================================
// オッズ色（<10=灰, 10-50=橙, ≥50=緑）
// ==========================================
function oddsColor(odds: number): string {
  if (odds >= 50) return '#276749'; // 緑（大穴）
  if (odds >= 10) return '#c05621'; // 橙（中穴）
  return '#718096';                 // 灰（人気）
}

// ==========================================
// 馬ピル（枠色付き選択ボタン）
// preEntry=true のとき枠番バッジを灰色で表示
// ==========================================
function HorsePill({
  horse,
  selected,
  onClick,
  preEntry = false,
}: {
  horse: Horse;
  selected: boolean;
  onClick: () => void;
  preEntry?: boolean;
}) {
  const waku = preEntry
    ? { bg: '#e2e8f0', border: '#a0aec0', text: '#4a5568' }  // 灰色（仮番号）
    : (WAKU_COLORS[horse.waku] ?? WAKU_COLORS[1]);

  return (
    <button
      onClick={onClick}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.25rem 0.6rem',
        border: `2px solid ${selected ? '#2b6cb0' : waku.border}`,
        borderRadius: '999px',
        cursor: 'pointer',
        background: selected ? '#ebf8ff' : '#f7f7f7',
        fontWeight: selected ? 700 : 400,
        outline: selected ? '2px solid #2b6cb0' : 'none',
        outlineOffset: '1px',
      }}
    >
      {/* 枠番バッジ（仮予想モードは灰色） */}
      <span
        style={{
          display: 'inline-block',
          width: '1.2rem',
          height: '1.2rem',
          borderRadius: '3px',
          background: waku.bg,
          border: `1px solid ${waku.border}`,
          color: waku.text,
          fontSize: '0.7rem',
          lineHeight: '1.2rem',
          textAlign: 'center',
          fontWeight: 700,
          flexShrink: 0,
        }}
      >
        {horse.id}
      </span>
      {/* 馬名（上段）＋ 騎手名（下段・小フォント）の2行レイアウト
          スマホでピル幅が広がりすぎないよう縦積みにする */}
      <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
        <span style={{ fontSize: '0.85rem' }}>{horse.id}番 {horse.name}</span>
        <span style={{ fontSize: '0.72rem', color: '#718096', fontWeight: 400 }}>{horse.jockey}</span>
      </span>
    </button>
  );
}

// ==========================================
// 組み合わせカード
// oddsDisplay: 表示するオッズ文字列（null = "-"）
// isEstimated: true のとき "~" プレフィックスを付ける
// ==========================================
function ComboCard({
  label,
  ev,
  score,
  oddsDisplay,
  isEstimated,
  rank,
}: {
  label: string;
  ev: number | null;
  score: number;
  oddsDisplay: number | null;
  isEstimated: boolean;
  rank: number;
}) {
  const evStyle = ev !== null ? evBadgeStyle(ev) : { background: '#718096', color: '#fff' };
  const cardBorder =
    rank === 0 && ev !== null ? '2px solid #276749' :
    ev !== null && ev >= 1.0  ? '2px solid #3182ce' :
    '1px solid #ddd';
  const cardBg =
    rank === 0 && ev !== null ? '#f0fff4' :
    ev !== null && ev >= 1.0  ? '#ebf8ff' :
    '#fff';

  const oddsText =
    oddsDisplay === null
      ? '-'
      : `${isEstimated ? '~' : ''}${oddsDisplay}倍`;
  const oddsStyle: React.CSSProperties =
    oddsDisplay === null
      ? { fontSize: '0.8rem', color: '#999' }
      : {
          fontSize: '0.8rem',
          fontWeight: 700,
          color: isEstimated ? '#718096' : oddsColor(oddsDisplay),
        };

  return (
    <div style={{
      border: cardBorder,
      borderRadius: '8px',
      padding: '0.6rem 0.9rem',
      background: cardBg,
      opacity: ev !== null && ev < 0.6 ? 0.7 : 1,
      display: 'flex',
      flexDirection: 'column',
      gap: '0.25rem',
      minWidth: '140px',
    }}>
      <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#333' }}>{label}</div>
      <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{
          ...evStyle,
          padding: '0.1rem 0.4rem',
          borderRadius: '4px',
          fontSize: '0.8rem',
          fontWeight: 700,
        }}>
          {ev !== null ? `EV ${ev.toFixed(3)}` : 'EV -'}
        </span>
        <span style={{ fontSize: '0.8rem', color: '#555' }}>S {score.toFixed(1)}</span>
        <span style={oddsStyle}>{oddsText}</span>
      </div>
    </div>
  );
}

// ==========================================
// 券種設定
// ==========================================
type BetConfig = {
  type: BetType;
  label: string;
  hasMode: boolean;    // ボックス/フォーメーション切り替えを持つか
  cols: number;        // フォーメーション列数
  colLabels: string[]; // フォーメーション列ラベル
};

const BET_CONFIGS: BetConfig[] = [
  { type: 'tan',     label: '単勝',   hasMode: false, cols: 1, colLabels: [''] },
  { type: 'fuku',    label: '複勝',   hasMode: false, cols: 1, colLabels: [''] },
  { type: 'waku',    label: '枠連',   hasMode: true,  cols: 2, colLabels: ['軸枠', '相手枠'] },
  { type: 'umaren',  label: '馬連',   hasMode: true,  cols: 2, colLabels: ['軸', '相手'] },
  { type: 'wide',    label: 'ワイド', hasMode: true,  cols: 2, colLabels: ['軸', '相手'] },
  { type: 'umatan',  label: '馬単',   hasMode: true,  cols: 2, colLabels: ['1着', '2着'] },
  { type: 'sanfuku', label: '三連複', hasMode: true,  cols: 3, colLabels: ['1軸', '2軸', 'ひも'] },
  { type: 'santan',  label: '三連単', hasMode: true,  cols: 3, colLabels: ['1着', '2着', '3着'] },
];

// ==========================================
// 選択モード・フォーメーション状態型
// ==========================================
type SelectMode = 'box' | 'form';
type FormCol = 'A' | 'B' | 'C';
type FormSel = { A: number[]; B: number[]; C: number[] };

// ==========================================
// 組み合わせ型（lookupKey = ComboOddsData の参照キー）
// ==========================================
type Combo = {
  key: string;        // React key（ユニーク識別子）
  lookupKey: string;  // ComboOddsData のフィールドから引くためのキー
  label: string;
  estOdds: number;    // 推定オッズ（実オッズ未取得時のフォールバック）
  ev: number;         // 推定EV（実オッズ未取得時のフォールバック）
  score: number;
  horseIds: number[]; // calcComboEV に渡す馬番リスト
};

// ==========================================
// 推定オッズ計算
// ==========================================
function calcEstOdds(type: BetType, hs: Horse[]): number {
  const [h1, h2, h3] = hs;
  let raw = 0;
  switch (type) {
    case 'tan':     raw = h1 ? h1.odds : 0; break;
    case 'fuku':    raw = h1 ? h1.fukuOddsMin : 0; break;
    case 'waku':    raw = (h1 && h2) ? h1.odds * h2.odds * 0.22 : 0; break;
    case 'umaren':  raw = (h1 && h2) ? h1.odds * h2.odds * 0.20 : 0; break;
    case 'wide':    raw = (h1 && h2) ? h1.odds * h2.odds * 0.35 : 0; break;
    case 'umatan':  raw = (h1 && h2) ? h1.odds * h2.odds * 0.12 : 0; break;
    case 'sanfuku': raw = (h1 && h2 && h3) ? h1.odds * h2.odds * h3.odds * 0.08 : 0; break;
    case 'santan':  raw = (h1 && h2 && h3) ? h1.odds * h2.odds * h3.odds * 0.10 : 0; break;
  }
  return Math.round(raw * 10) / 10;
}

function avgField(hs: Horse[], field: 'ev' | 'score'): number {
  if (hs.length === 0) return 0;
  return hs.reduce((s, h) => s + (h[field] ?? 0), 0) / hs.length;
}

// ==========================================
// ComboOddsData から実オッズを引く
// ==========================================
function lookupRealOdds(
  data: ComboOddsData,
  type: BetType,
  lookupKey: string,
): number | undefined {
  switch (type) {
    case 'waku':    return data.waku[lookupKey];
    case 'umaren':  return data.umaren[lookupKey];
    case 'umatan':  return data.umatan[lookupKey];
    case 'wide':    return data.wide[lookupKey];
    case 'sanfuku': return data.sanfuku[lookupKey];
    case 'santan':  return data.santan[lookupKey];
    default:        return undefined;
  }
}

// ==========================================
// 組み合わせ生成
// ==========================================
function genCombos(
  type: BetType,
  mode: SelectMode,
  boxSel: number[],
  formSel: FormSel,
  horses: Horse[]
): Combo[] {
  const getH = (id: number) => horses.find(h => h.id === id);

  // 単勝・複勝
  if (type === 'tan' || type === 'fuku') {
    return boxSel.flatMap(id => {
      const h = getH(id);
      if (!h) return [];
      return [{
        key: String(id),
        lookupKey: String(id),
        label: `${h.id}番 ${h.name}`,
        estOdds: calcEstOdds(type, [h]),
        ev: h.ev ?? 0,
        score: h.score ?? 0,
        horseIds: [id],
      }];
    });
  }

  // 枠連
  if (type === 'waku') {
    const wakuPairs: [number, number][] = [];
    const addWakuPair = (w1: number, w2: number) => {
      const p: [number, number] = [Math.min(w1, w2), Math.max(w1, w2)];
      if (!wakuPairs.some(x => x[0] === p[0] && x[1] === p[1])) wakuPairs.push(p);
    };
    if (mode === 'box') {
      const wakus = Array.from(new Set(
        boxSel.map(id => getH(id)?.waku).filter((w): w is number => w !== undefined)
      )).sort((a, b) => a - b);
      for (let i = 0; i < wakus.length; i++)
        for (let j = i + 1; j < wakus.length; j++)
          addWakuPair(wakus[i], wakus[j]);
    } else {
      const wA = Array.from(new Set(formSel.A.map(id => getH(id)?.waku).filter((w): w is number => w !== undefined)));
      const wB = Array.from(new Set(formSel.B.map(id => getH(id)?.waku).filter((w): w is number => w !== undefined)));
      for (const wa of wA)
        for (const wb of wB)
          if (wa !== wb) addWakuPair(wa, wb);
    }
    return wakuPairs.map(([w1, w2]) => {
      const h1s = horses.filter(h => h.waku === w1);
      const h2s = horses.filter(h => h.waku === w2);
      const avg1 = h1s.reduce((s, h) => s + h.odds, 0) / h1s.length;
      const avg2 = h2s.reduce((s, h) => s + h.odds, 0) / h2s.length;
      const allH = [...h1s, ...h2s];
      const repH1 = { ...h1s[0], odds: avg1 } as Horse;
      const repH2 = { ...h2s[0], odds: avg2 } as Horse;
      const lk = `${w1}-${w2}`;
      return {
        key: `waku-${lk}`,
        lookupKey: lk,
        label: `枠${w1}-枠${w2}`,
        estOdds: calcEstOdds('waku', [repH1, repH2]),
        ev: avgField(allH, 'ev'),
        score: avgField(allH, 'score'),
        horseIds: [...h1s.map(h => h.id), ...h2s.map(h => h.id)],
      };
    });
  }

  // 馬連・ワイド（順不同ペア）
  if (type === 'umaren' || type === 'wide') {
    const pairs: [number, number][] = [];
    const addPair = (a: number, b: number) => {
      const p: [number, number] = [Math.min(a, b), Math.max(a, b)];
      if (!pairs.some(x => x[0] === p[0] && x[1] === p[1])) pairs.push(p);
    };
    if (mode === 'box') {
      for (let i = 0; i < boxSel.length; i++)
        for (let j = i + 1; j < boxSel.length; j++)
          addPair(boxSel[i], boxSel[j]);
    } else {
      for (const a of formSel.A)
        for (const b of formSel.B)
          if (a !== b) addPair(a, b);
    }
    return pairs.flatMap(([id1, id2]) => {
      const h1 = getH(id1), h2 = getH(id2);
      if (!h1 || !h2) return [];
      const lk = `${id1}-${id2}`;
      return [{
        key: lk,
        lookupKey: lk,
        label: `${id1}番-${id2}番`,
        estOdds: calcEstOdds(type, [h1, h2]),
        ev: avgField([h1, h2], 'ev'),
        score: avgField([h1, h2], 'score'),
        horseIds: [id1, id2],
      }];
    });
  }

  // 馬単（順序付きペア）
  if (type === 'umatan') {
    const pairs: [number, number][] = [];
    if (mode === 'box') {
      for (const a of boxSel)
        for (const b of boxSel)
          if (a !== b) pairs.push([a, b]);
    } else {
      for (const a of formSel.A)
        for (const b of formSel.B)
          if (a !== b) pairs.push([a, b]);
    }
    return pairs.flatMap(([id1, id2]) => {
      const h1 = getH(id1), h2 = getH(id2);
      if (!h1 || !h2) return [];
      const lk = `${id1}-${id2}`;
      return [{
        key: `${id1}->${id2}`,
        lookupKey: lk,
        label: `${id1}番→${id2}番`,
        estOdds: calcEstOdds('umatan', [h1, h2]),
        ev: avgField([h1, h2], 'ev'),
        score: avgField([h1, h2], 'score'),
        horseIds: [id1, id2],
      }];
    });
  }

  // 三連複（順不同3頭組）
  if (type === 'sanfuku') {
    const triples: [number, number, number][] = [];
    const addTriple = (a: number, b: number, c: number) => {
      const s = [a, b, c].sort((x, y) => x - y) as [number, number, number];
      if (!triples.some(t => t[0] === s[0] && t[1] === s[1] && t[2] === s[2])) triples.push(s);
    };
    if (mode === 'box') {
      for (let i = 0; i < boxSel.length; i++)
        for (let j = i + 1; j < boxSel.length; j++)
          for (let k = j + 1; k < boxSel.length; k++)
            addTriple(boxSel[i], boxSel[j], boxSel[k]);
    } else {
      for (const a of formSel.A)
        for (const b of formSel.B)
          for (const c of formSel.C)
            if (new Set([a, b, c]).size === 3) addTriple(a, b, c);
    }
    return triples.flatMap(([id1, id2, id3]) => {
      const h1 = getH(id1), h2 = getH(id2), h3 = getH(id3);
      if (!h1 || !h2 || !h3) return [];
      const lk = `${id1}-${id2}-${id3}`;
      return [{
        key: lk,
        lookupKey: lk,
        label: `${id1}番-${id2}番-${id3}番`,
        estOdds: calcEstOdds('sanfuku', [h1, h2, h3]),
        ev: avgField([h1, h2, h3], 'ev'),
        score: avgField([h1, h2, h3], 'score'),
        horseIds: [id1, id2, id3],
      }];
    });
  }

  // 三連単（順序付き3頭組）
  if (type === 'santan') {
    const triples: [number, number, number][] = [];
    if (mode === 'box') {
      for (const a of boxSel)
        for (const b of boxSel)
          for (const c of boxSel)
            if (a !== b && b !== c && a !== c) triples.push([a, b, c]);
    } else {
      for (const a of formSel.A)
        for (const b of formSel.B)
          for (const c of formSel.C)
            if (a !== b && b !== c && a !== c) triples.push([a, b, c]);
    }
    return triples.flatMap(([id1, id2, id3]) => {
      const h1 = getH(id1), h2 = getH(id2), h3 = getH(id3);
      if (!h1 || !h2 || !h3) return [];
      const lk = `${id1}-${id2}-${id3}`;
      return [{
        key: `${id1}->${id2}->${id3}`,
        lookupKey: lk,
        label: `${id1}番→${id2}番→${id3}番`,
        estOdds: calcEstOdds('santan', [h1, h2, h3]),
        ev: avgField([h1, h2, h3], 'ev'),
        score: avgField([h1, h2, h3], 'score'),
        horseIds: [id1, id2, id3],
      }];
    });
  }

  return [];
}

// ==========================================
// メインコンポーネント
// ==========================================
type Props = { race: Race };

const EMPTY_FORM_SEL: FormSel = { A: [], B: [], C: [] };

export function BakenSimulator({ race }: Props) {
  const isPreEntry = race.mode === 'pre-entry';
  // 予想オッズが1頭でも取得できていれば true
  const hasEstimatedOdds = isPreEntry && race.horses.some(h => h.odds > 0);

  const [betType, setBetType] = useState<BetType>('tan');
  const [mode, setMode]       = useState<SelectMode>('box');
  const [boxSel, setBoxSel]   = useState<number[]>([]);
  const [formSel, setFormSel] = useState<FormSel>(EMPTY_FORM_SEL);

  // 組み合わせオッズを非同期取得
  // 仮予想モードでかつ予想オッズもない場合はスキップ
  const comboOdds = useComboOdds((isPreEntry && !hasEstimatedOdds) ? '' : race.raceId);

  // レースが切り替わったら全選択状態をリセット
  useEffect(() => {
    setBetType('tan');
    setMode('box');
    setBoxSel([]);
    setFormSel(EMPTY_FORM_SEL);
  }, [race.raceId]);

  const cfg = BET_CONFIGS.find(c => c.type === betType) ?? BET_CONFIGS[0];

  // 馬番昇順ソート（選択UI用）
  const idSortedHorses = useMemo(
    () => [...race.horses].sort((a, b) => a.id - b.id),
    [race.horses]
  );

  // EV降順ソート（EV一覧用）
  const evSortedHorses = useMemo(
    () => [...race.horses].sort((a, b) => (b.ev ?? 0) - (a.ev ?? 0)),
    [race.horses]
  );

  // 券種切り替え
  const handleBetType = (t: BetType) => {
    setBetType(t);
    setMode('box');
    setBoxSel([]);
    setFormSel(EMPTY_FORM_SEL);
  };

  // モード切り替え
  const handleMode = (m: SelectMode) => {
    setMode(m);
    setBoxSel([]);
    setFormSel(EMPTY_FORM_SEL);
  };

  const toggleBox = (id: number) => {
    setBoxSel(prev =>
      prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]
    );
  };

  const toggleForm = (col: FormCol, id: number) => {
    setFormSel(prev => ({
      ...prev,
      [col]: prev[col].includes(id)
        ? prev[col].filter(x => x !== id)
        : [...prev[col], id],
    }));
  };

  // 組み合わせ生成
  const combos = useMemo(
    () => genCombos(betType, mode, boxSel, formSel, race.horses),
    [betType, mode, boxSel, formSel, race.horses]
  );

  // 実オッズ・実EV付きの解決済みCombo型
  type ResolvedCombo = Combo & {
    realOdds: number | null;
    realEV: number | null;
    isEstimated: boolean;
  };

  // 実EV降順（null最後）・上位50件
  // 仮予想モードではEV計算不可のためスコア降順で表示
  const sortedCombos = useMemo((): ResolvedCombo[] => {
    const resolved = combos.map((c): ResolvedCombo => {
      // 仮予想モードかつオッズ未取得: スコアのみ表示
      if (isPreEntry && !hasEstimatedOdds) {
        return { ...c, realOdds: null, realEV: null, isEstimated: false };
      }
      // 単勝・複勝は馬データのオッズ・EVをそのまま使う
      if (betType === 'tan' || betType === 'fuku') {
        return { ...c, realOdds: c.estOdds, realEV: c.ev, isEstimated: false };
      }
      if (comboOdds.data) {
        const found = lookupRealOdds(comboOdds.data, betType, c.lookupKey);
        if (found !== undefined) {
          const hs = c.horseIds
            .map(id => race.horses.find(h => h.id === id))
            .filter((h): h is Horse => h !== undefined);
          const realEV = calcComboEV(hs, found, betType, race.horses);
          return { ...c, realOdds: found, realEV, isEstimated: false };
        }
        // 実オッズが存在しない組み合わせ（発売なし等）
        return { ...c, realOdds: null, realEV: null, isEstimated: false };
      }
      // オッズ未取得 → 推定値でフォールバック（EV は null）
      return { ...c, realOdds: c.estOdds, realEV: null, isEstimated: true };
    });

    return resolved
      .sort((a, b) => {
        // 仮予想モードかつオッズなし: スコア降順
        if (isPreEntry && !hasEstimatedOdds) return b.score - a.score;
        if (a.realEV !== null && b.realEV !== null) return b.realEV - a.realEV;
        if (a.realEV !== null) return -1;
        if (b.realEV !== null) return 1;
        return b.ev - a.ev; // 両方 null の場合は推定EV順
      })
      .slice(0, 50);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [combos, comboOdds.data, betType, race.horses, isPreEntry, hasEstimatedOdds]);

  return (
    <div style={{ fontFamily: 'sans-serif' }}>
      {/* 仮予想モードバナー */}
      {isPreEntry && <PreEntryBanner hasOdds={hasEstimatedOdds} />}

      {/* レース情報ヘッダー */}
      <div style={styles.raceHeader}>
        <h2 style={{ margin: 0, fontSize: '1.3rem' }}>{race.name}</h2>
        <span style={styles.raceMeta}>
          {race.course}・{race.surface === 'turf' ? '芝' : 'ダート'}{race.distance}m・{race.horses.length}頭
        </span>
      </div>

      {/* 券種タブ */}
      <div style={styles.tabRow}>
        {BET_CONFIGS.map(({ type, label }) => {
          // 仮予想モードでは単勝のみ選択可能、他はグレーアウト
          const disabled = isPreEntry && type !== 'tan';
          return (
            <button
              key={type}
              onClick={() => !disabled && handleBetType(type)}
              title={disabled ? '枠順確定後に利用可能になります' : undefined}
              style={{
                ...styles.tab,
                background: disabled
                  ? '#e2e8f0'
                  : betType === type ? '#2b6cb0' : '#edf2f7',
                color: disabled
                  ? '#a0aec0'
                  : betType === type ? '#fff' : '#333',
                fontWeight: betType === type ? 700 : 400,
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.7 : 1,
              }}
            >
              {label}
            </button>
          );
        })}
      </div>

      {/* ボックス/フォーメーション切り替え */}
      {cfg.hasMode && (
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {(['box', 'form'] as const).map(m => (
            <button
              key={m}
              onClick={() => handleMode(m)}
              style={{
                padding: '0.3rem 0.9rem',
                border: `1px solid ${mode === m ? '#2b6cb0' : '#ccc'}`,
                borderRadius: '4px',
                background: mode === m ? '#ebf8ff' : '#fff',
                color: mode === m ? '#2b6cb0' : '#555',
                fontWeight: mode === m ? 700 : 400,
                cursor: 'pointer',
                fontSize: '0.85rem',
              }}
            >
              {m === 'box' ? 'ボックス' : 'フォーメーション'}
            </button>
          ))}
          {/* オッズ取得状態インジケーター */}
          {comboOdds.isLoading && (
            <span style={{ fontSize: '0.8rem', color: '#888', alignSelf: 'center' }}>
              オッズ取得中…
            </span>
          )}
        </div>
      )}

      {/* 馬選択エリア */}
      <div style={styles.section}>
        {!cfg.hasMode || mode === 'box' ? (
          <>
            <p style={styles.hint}>
              {betType === 'tan' || betType === 'fuku'
                ? '馬を選択してください（複数選択で複数点表示）'
                : 'ボックス：選択馬の全組み合わせを自動生成します'}
            </p>
            <div style={styles.pillGrid}>
              {idSortedHorses.map(horse => (
                <HorsePill
                  key={horse.id}
                  horse={horse}
                  selected={boxSel.includes(horse.id)}
                  onClick={() => toggleBox(horse.id)}
                  preEntry={isPreEntry}
                />
              ))}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {(['A', 'B', 'C'] as FormCol[]).slice(0, cfg.cols).map((col, ci) => (
              <div key={col}>
                <p style={{ ...styles.hint, fontWeight: 700, color: '#444', marginBottom: '0.35rem' }}>
                  {cfg.colLabels[ci]}
                  {formSel[col].length > 0 && (
                    <span style={{ fontWeight: 400, color: '#888', marginLeft: '0.4rem' }}>
                      {formSel[col].length}頭選択
                    </span>
                  )}
                </p>
                <div style={styles.pillGrid}>
                  {idSortedHorses.map(horse => (
                    <HorsePill
                      key={horse.id}
                      horse={horse}
                      selected={formSel[col].includes(horse.id)}
                      onClick={() => toggleForm(col, horse.id)}
                      preEntry={isPreEntry}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 組み合わせ一覧（実オッズ or 推定オッズ） */}
      {combos.length > 0 && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>
            組み合わせ一覧
            <span style={{ fontSize: '0.8rem', fontWeight: 400, color: '#666', marginLeft: '0.5rem' }}>
              {combos.length}通り{combos.length > 50 && '（上位50件表示）'}
            </span>
            {!comboOdds.data && !comboOdds.isLoading && betType !== 'tan' && betType !== 'fuku' && (
              <span style={{ fontSize: '0.75rem', fontWeight: 400, color: '#c05621', marginLeft: '0.5rem' }}>
                ～推定オッズ表示中
              </span>
            )}
          </h3>
          <div style={styles.cardGrid}>
            {sortedCombos.map((c, i) => (
              <ComboCard
                key={c.key}
                label={c.label}
                ev={c.realEV}
                score={c.score}
                oddsDisplay={c.realOdds}
                isEstimated={c.isEstimated}
                rank={i}
              />
            ))}
          </div>
        </div>
      )}

      {/* 全馬EV一覧（単勝）— EV降順 / 仮予想モードかつオッズなしの場合は非表示 */}
      {(!isPreEntry || hasEstimatedOdds) && (
        <div style={styles.section}>
          <h3 style={styles.sectionTitle}>EV一覧（単勝）</h3>
          <div style={styles.cardGrid}>
            {evSortedHorses.map((horse, i) => (
              <ComboCard
                key={horse.id}
                label={`${horse.id}番 ${horse.name}`}
                ev={horse.ev ?? 0}
                score={horse.score ?? 0}
                oddsDisplay={horse.odds}
                isEstimated={false}
                rank={i}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  raceHeader: {
    display: 'flex',
    alignItems: 'baseline',
    gap: '1rem',
    marginBottom: '1rem',
    flexWrap: 'wrap',
  },
  raceMeta: { color: '#555', fontSize: '0.9rem' },
  tabRow: { display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '1rem' },
  tab: { padding: '0.35rem 0.9rem', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '0.9rem' },
  section: { marginBottom: '1.5rem' },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, margin: '0 0 0.6rem', color: '#333' },
  hint: { fontSize: '0.85rem', color: '#666', margin: '0 0 0.6rem' },
  pillGrid: { display: 'flex', flexWrap: 'wrap', gap: '0.5rem' },
  cardGrid: { display: 'flex', flexWrap: 'wrap', gap: '0.6rem' },
};
