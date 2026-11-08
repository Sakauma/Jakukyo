import { useMemo, useState, useSyncExternalStore } from 'react';
import { getMode } from '../game/catalog';
import { listRecords, subscribeRecords } from '../records/store';
import { getStatistics } from '../records/stats';
import type { GameRecord, StatisticsGroup } from '../records/types';

const groupKey = (group: StatisticsGroup) => `${group.mode}:${group.playerCount}:${group.scoreUnit}`;
const format = (value: number, digits = 0) => value.toLocaleString('zh-CN', { maximumFractionDigits: digits, minimumFractionDigits: digits });
const percent = (value: number) => `${format(value, 1)}%`;

export function StatsPanel({ onLibrary }: { onLibrary: () => void }) {
  const records = useSyncExternalStore(subscribeRecords, listRecords, listRecords);
  const [source, setSource] = useState<GameRecord['source']>('played');
  const [selectedKey, setSelectedKey] = useState('');
  const groups = useMemo(() => getStatistics(source === 'played' ? undefined : records, source), [records, source]);
  const group = groups.find(item => groupKey(item) === selectedKey) ?? groups[0];
  const recordCount = records.filter(record => record.source === source).length;
  const cards = group ? [
    { label: '已结算局数', value: format(group.settledHands) },
    { label: '完成场数', value: format(group.completedMatches) },
    { label: '和牌率', value: group.settledHands ? percent(group.winRate) : '—' },
    { label: '放铳率', value: group.settledHands ? percent(group.dealInRate) : '—' },
    { label: '平均名次', value: group.averageRank == null ? '—' : format(group.averageRank, 2) },
    { label: `平均和牌得分 · ${group.scoreUnit}`, value: group.averageWinPoints == null ? '—' : format(group.averageWinPoints, 1) },
    { label: '立直率', value: ['riichi', 'sanma'].includes(group.mode) && group.settledHands ? percent(group.riichiRate) : '—' },
    { label: '副露率', value: group.settledHands ? percent(group.openMeldRate) : '—' },
  ] : [];

  return <div className="stats-view">
    <div className="stats-toolbar"><div className="stats-source" role="group" aria-label="战绩来源"><button type="button" aria-pressed={source === 'played'} className={source === 'played' ? 'is-selected' : ''} onClick={() => setSource('played')}>本人对局</button><button type="button" aria-pressed={source === 'imported'} className={source === 'imported' ? 'is-selected' : ''} onClick={() => setSource('imported')}>导入牌谱</button></div>{group && <label>玩法<select aria-label="战绩玩法" value={groupKey(group)} onChange={event => setSelectedKey(event.target.value)}>{groups.map(item => <option key={groupKey(item)} value={groupKey(item)}>{getMode(item.mode).name} · {item.playerCount} 人 · {item.scoreUnit}</option>)}</select></label>}</div>
    
    {!group ? <div className="stats-empty"><span>局</span><h4>{source === 'played' ? '还没有本地对局记录' : '还没有导入牌谱'}</h4><button type="button" onClick={onLibrary}>打开牌谱库 →</button></div> : <>
      <div className="stats-kpis">{cards.map(card => <article key={card.label}><span>{card.label}</span><strong>{card.value}</strong></article>)}</div>
      <div className="stats-bottom"><section className="stats-ranks" aria-label="最终名次分布"><header><strong>名次分布</strong><small>{getMode(group.mode).name} · {group.playerCount} 人</small></header>{group.rankCounts.map((count, index) => <div key={index}><span>第 {index + 1} 名</span><div className="stats-rank-track"><i style={{ width: `${group.rankedMatches ? count / group.rankedMatches * 100 : 0}%` }} /></div><b>{count}<small>场</small></b></div>)}{!group.rankedMatches && <p>完成整场对局后，这里会出现名次分布。</p>}</section><section className="stats-definitions"><h4>对局记录</h4><p>和牌 {format(group.winEvents)} 次 · 放铳 {format(group.dealInEvents)} 次</p><p>牌谱 {recordCount} 份</p><button type="button" onClick={onLibrary}>到牌谱库复盘 →</button></section></div>
    </>}
  </div>;
}
