import { useEffect, useMemo, useRef, useState } from 'react';
import { isKeyReplayDecision, replayDecisionCategory } from '../game/replayAnalysis';
import type { ReplayActionAssessment, ReplayDecisionAnalysis } from '../game/replayAnalysis';
import type { ReplayFrame } from '../game/types';
import { tileLabel } from '../game/variants/tiles';
import { TilePortrait } from '../table/TilePortrait';
import type { TableTheme } from '../table/themes';
import { ReplayAnalysisService } from './analysisService';
import './replayAnalysis.css';

interface Props {
  frames: ReplayFrame[];
  index: number;
  onGo: (index: number) => void;
  onPause: () => void;
  theme: TableTheme;
}

function ActionAssessment({ value, title, theme }: { value: ReplayActionAssessment; title: string; theme: TableTheme }) {
  const tiles = value.action.tiles?.length ? value.action.tiles : value.action.tile ? [value.action.tile] : [];
  const riskLabel = value.riskContext === 'followup' ? '续打风险' : value.riskContext === 'addedKan' ? '抢杠风险' : '弃牌风险';
  return <section className="replay-analysis-choice">
    <h4>{title}</h4>
    <strong className="replay-analysis-action">{value.action.label}</strong>
    {!!tiles.length && <div className="replay-analysis-tiles">{tiles.map((tile, at) => <TilePortrait key={at} tile={tile} theme={theme} />)}</div>}
    {value.followupTile && <p className="replay-analysis-followup">续打 {tileLabel(value.followupTile)}</p>}
    {['kan', 'kita'].includes(value.action.type) && <p className="replay-analysis-followup">补牌前牌形</p>}
    <dl>
      <div><dt>向听</dt><dd>{value.shanten == null ? '—' : value.shanten < 0 ? '和牌' : value.shanten === 0 ? '听牌' : value.shanten}</dd></div>
      <div><dt>有效牌</dt><dd>{value.ukeire == null || value.shanten === -1 ? '—' : `${value.ukeire}张`}</dd></div>
      <div><dt>{riskLabel}</dt><dd className={`analysis-risk-${value.risk ?? 'none'}`}>{value.risk == null ? '—' : ({ low: '低', medium: '中', high: '高' }[value.risk])}</dd></div>
    </dl>
    <ul className="replay-analysis-reasons">{value.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
  </section>;
}

export function ReplayDecisionPanel({ frames, index, onGo, onPause, theme }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [service] = useState(() => new ReplayAnalysisService());
  const generation = useRef(0);
  const cache = useRef(new Map<number, ReplayDecisionAnalysis>());
  const [cacheRevision, setCacheRevision] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [retry, setRetry] = useState(0);
  const [scan, setScan] = useState<{ done: number; total: number } | null>(null);
  const [scannedRounds, setScannedRounds] = useState<string[]>([]);
  const [keyOnly, setKeyOnly] = useState(false);
  const point = frames[index]?.decision;
  const roundKey = frames[index]?.roundKey;
  const decisions = useMemo(() => frames.flatMap((frame, at) => frame.decision ? [{ index: at, frame, point: frame.decision }] : []), [frames]);
  const roundDecisions = useMemo(() => decisions.filter(item => item.frame.roundKey === roundKey), [decisions, roundKey]);
  const keyDecisions = useMemo(() => roundDecisions.filter(item => {
    const result = cache.current.get(item.index);
    return result && isKeyReplayDecision(item.point, result);
  }), [roundDecisions, cacheRevision]);
  const current = cache.current.get(index);
  const choices = keyOnly ? keyDecisions : roundDecisions;
  const previous = [...choices].reverse().find(item => item.index < index);
  const next = choices.find(item => item.index > index);
  const scanned = !!roundKey && scannedRounds.includes(roundKey);

  useEffect(() => () => { generation.current++; service.dispose(); }, [service]);
  useEffect(() => {
    const request = ++generation.current;
    service.cancel();
    setScan(null); setError(''); setLoading(false);
    if (!expanded || !point || cache.current.has(index)) return;
    setLoading(true);
    void service.analyze(point).then(result => {
      if (generation.current !== request || !result) return;
      cache.current.set(index, result); setCacheRevision(value => value + 1); setLoading(false);
    }).catch(reason => {
      if (generation.current !== request) return;
      setLoading(false); setError(reason instanceof Error ? reason.message : '本次分析未能完成。');
    });
    return () => { if (generation.current === request) { generation.current++; service.cancel(); } };
  }, [service, expanded, index, point, retry]);

  function toggle() {
    onPause();
    if (!expanded && !point) {
      const target = roundDecisions.find(item => item.index >= index) ?? roundDecisions[0] ?? decisions[0];
      if (target) onGo(target.index);
    }
    setExpanded(value => !value);
  }

  function stopScan() {
    generation.current++; service.cancel(); setScan(null); setLoading(false);
  }

  async function analyzeRound() {
    onPause();
    const request = ++generation.current;
    service.cancel(); setLoading(false); setError('');
    setScan({ done: 0, total: roundDecisions.length });
    try {
      for (const [at, item] of roundDecisions.entries()) {
        if (generation.current !== request) return;
        if (!cache.current.has(item.index)) {
          const result = await service.analyze(item.point);
          if (generation.current !== request || !result) return;
          cache.current.set(item.index, result); setCacheRevision(value => value + 1);
        }
        setScan({ done: at + 1, total: roundDecisions.length });
      }
      if (generation.current !== request) return;
      if (roundKey) setScannedRounds(rounds => [...new Set([...rounds, roundKey])]);
      setKeyOnly(true); setScan(null);
    } catch (reason) {
      if (generation.current !== request) return;
      setScan(null); setError(reason instanceof Error ? reason.message : '本局分析未能完成。');
    }
  }

  if (!decisions.length) return null;
  return <section className={`replay-analysis ${expanded ? 'is-open' : ''}`} aria-label="关键决策分析">
    <button type="button" className="replay-analysis-toggle" aria-expanded={expanded} onClick={toggle}>{expanded ? '收起决策分析' : '决策分析'}</button>
    {expanded && <>
      <div className="replay-analysis-tools">
        {scan ? <><span role="status">分析本局 {scan.done}/{scan.total}</span><button type="button" onClick={stopScan}>取消分析</button></>
          : <button type="button" disabled={!roundDecisions.length} onClick={() => { void analyzeRound(); }}>{scanned ? '重新定位本局' : '分析本局关键选择'}</button>}
        {scanned && <button type="button" aria-pressed={keyOnly} onClick={() => setKeyOnly(value => !value)}>{keyOnly ? `关键 ${keyDecisions.length}处` : '全部决策'}</button>}
      </div>
      <div className="replay-decision-navigation">
        <button type="button" disabled={!previous} onClick={() => previous && onGo(previous.index)}>上一决策</button>
        <button type="button" disabled={!next} onClick={() => next && onGo(next.index)}>下一决策</button>
        <select aria-label="定位决策" value={choices.some(item => item.index === index) ? String(index) : ''} onChange={event => { if (event.target.value !== '') onGo(Number(event.target.value)); }}>
          <option value="">{keyOnly && !choices.length ? '本局暂无明显分歧' : '选择决策'}</option>
          {choices.map((item, at) => <option key={item.index} value={item.index}>{at + 1} · {replayDecisionCategory(item.point)} · {item.point.actions.find(action => action.key === item.point.actualKey)?.label}</option>)}
        </select>
      </div>
      {loading && <p className="replay-analysis-status" role="status">正在分析这一步…</p>}
      {error && <div className="replay-analysis-status" role="alert"><p>{error}</p><button type="button" onClick={() => setRetry(value => value + 1)}>重试分析</button></div>}
      {current && point && <div className="replay-analysis-result" data-analysis-provider={current.provider}>
        <div className="replay-analysis-heading"><h3>{replayDecisionCategory(point)}</h3><span>{current.sameChoice ? '与 AI 建议一致' : '可对比的选择'}</span></div>
        <div className="replay-analysis-comparison">
          <ActionAssessment title="实际操作" value={current.actual} theme={theme} />
          <ActionAssessment title="当前高手建议" value={current.recommended} theme={theme} />
        </div>
      </div>}
      {!point && !loading && <p className="replay-analysis-status">选择上方决策查看。</p>}
    </>}
  </section>;
}
