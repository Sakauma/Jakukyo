import { useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent } from 'react';
import type { GameSnapshot, MeldView, RoundResult, RoundTransfer, ScoringEvidence, WinnerView, YakuView } from '../game/types';
import { getMode } from '../game/catalog';
import { TilePortrait } from '../table/TilePortrait';
import { tileName } from '../table/tileTextures';
import type { TableTheme } from '../table/themes';
import { presentedNumber, useSettlementPresentation } from './useSettlementPresentation';
import { displayScoringText, displayYakuName } from '../presentation/scoringText';
import { explainScoringItem } from './scoringEvidence';
import './settlement.css';

export interface RoundSettlementProps {
  snapshot: GameSnapshot;
  theme: TableTheme;
  reducedMotion?: boolean;
  onNext: () => void;
  onRestart: () => void;
  onLobby: () => void;
  onExport: () => void;
}

const pointModes = new Set(['hangzhou', 'wuhan', 'changsha', 'northeast']);
const format = (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 2 });
const signed = (value: number) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${format(Math.abs(value))}`;
const changeClass = (value: number) => value > 0 ? 'is-gain' : value < 0 ? 'is-loss' : 'is-even';
const isJapanese = (mode: string) => mode === 'riichi' || mode === 'sanma';
const countedUnit = (mode: string) => mode === 'taiwan' ? '台' : pointModes.has(mode) ? '分' : '番';
const nameOf = (snapshot: GameSnapshot, id: number) => snapshot.players.find(player => player.id === id)?.name ?? `玩家 ${id + 1}`;
const transferNames: Record<RoundTransfer['kind'], string> = {
  win: '和牌', 'concealed-kong': '暗杠', 'added-kong': '补杠', 'open-kong': '明杠',
  'kong-refund': '退杠税', 'ready-payment': '查大叫', 'flower-pig': '查花猪',
};

function actualGain(winner: WinnerView) {
  const payment = winner.payments?.[winner.playerId];
  return typeof payment === 'number' && Number.isFinite(payment) ? payment : winner.points;
}

function yakuValue(yaku: YakuView, mode: string) {
  // Regional scoring already tells us its units. A multiplier must not be
  // relabelled as Japanese han, nor used to invent a payment formula.
  if (typeof yaku.han === 'string') return /^\*+$/.test(yaku.han) ? `${yaku.han.length > 1 ? `${yaku.han.length} 倍` : ''}役满` : yaku.han;
  if (mode === 'hangzhou' && ['硬胡', '爆头'].includes(yaku.name) || mode === 'wuhan' && yaku.name === '硬胡') return `×${yaku.han}`;
  return `${format(yaku.han)} ${countedUnit(mode)}`;
}

function Arrow() {
  return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><path d="M4 12h16m-6-6 6 6-6 6" /></svg>;
}

function ScoreNumber({ value, progress, from = 0, signedValue = false }: { value: number; progress: number; from?: number; signedValue?: boolean }) {
  const formatter = signedValue ? signed : format;
  return <span aria-label={formatter(value)}><span aria-hidden="true">{formatter(presentedNumber(value, progress, from))}</span></span>;
}

function EvidenceTile({ tile, theme, highlighted = false, winning = false, concealed = false }: { tile: string; theme: TableTheme; highlighted?: boolean; winning?: boolean; concealed?: boolean }) {
  return <span className={`settlement-evidence-tile ${highlighted ? 'is-highlighted' : ''}`}><TilePortrait tile={tile} theme={theme} winning={winning} concealed={concealed && !highlighted} /></span>;
}

function WinTiles({ winner, snapshot, theme, evidence }: { winner: WinnerView; snapshot: GameSnapshot; theme: TableTheme; evidence?: ScoringEvidence }) {
  const tiles = winner.hand.map((tile, index) => ({ tile, index }));
  const winningIndex = winner.winningTile ? winner.hand.lastIndexOf(winner.winningTile) : -1;
  const winningTile = tiles[winningIndex];
  const concealed = tiles.filter(item => item.index !== winningIndex);
  const melds = winner.melds ?? [];

  return <section className="settlement-hand" aria-label="完整和牌牌面">
    <div className="settlement-section-label"><span>和牌手牌</span></div>
    <div className="settlement-hand-row">
      <div className="settlement-concealed-tiles">{concealed.map(({ tile, index }) => <EvidenceTile key={`${index}-${tile}`} tile={tile} theme={theme} highlighted={evidence?.hand?.includes(index)} />)}</div>
      {winningTile && <div className="settlement-winning-tile"><EvidenceTile tile={winningTile.tile} theme={theme} winning highlighted={evidence?.hand?.includes(winningIndex)} /><small>{winner.fromId == null ? '自摸' : '和牌'}</small></div>}
      {melds.length > 0 && <div className="settlement-melds" aria-label="和牌时的副露">{melds.map((meld, index) => <MeldTiles key={`${meld.id}-${index}`} meld={meld} snapshot={snapshot} theme={theme} highlighted={evidence?.melds?.find(item => item.index === index)?.tiles} />)}</div>}
    </div>
  </section>;
}

function MeldTiles({ meld, snapshot, theme, highlighted }: { meld: MeldView; snapshot: GameSnapshot; theme: TableTheme; highlighted?: number[] }) {
  const name = meld.type === 'chi' ? '吃' : meld.type === 'pon' ? '碰' : meld.concealed ? '暗杠' : '明杠';
  return <div className="settlement-meld" aria-label={`${name}${meld.from == null ? '' : `，来自${nameOf(snapshot, meld.from)}`}`}>
    <div>{meld.tiles.map((tile, index) => <EvidenceTile key={`${index}-${tile}`} tile={tile} theme={theme} highlighted={highlighted?.includes(index)} concealed={meld.concealed && (index === 0 || index === meld.tiles.length - 1)} />)}</div>
    <small>{name}{meld.from != null && <span> · {nameOf(snapshot, meld.from)}</span>}</small>
  </div>;
}

function Indicators({ snapshot, winner, theme, evidence }: { snapshot: GameSnapshot; winner: WinnerView; theme: TableTheme; evidence?: ScoringEvidence }) {
  const mode = snapshot.mode ?? 'riichi';
  const japanese = isJapanese(mode);
  const player = snapshot.players.find(item => item.id === winner.playerId);
  const dora = snapshot.round.doraIndicators;
  const ura = japanese && player?.riichi ? snapshot.round.uraIndicators : [];
  if (!dora.length && !ura.length && !snapshot.round.wildcard && !winner.flowers?.length && !winner.kita) return null;
  return <div className="settlement-indicators">
    {dora.length > 0 && <div><span>{japanese ? '宝牌指示牌' : '百搭指示牌'}</span><div>{dora.map((tile, index) => <TilePortrait key={`${index}-${tile}`} tile={tile} theme={theme} />)}</div></div>}
    {ura.length > 0 && <div><span>里宝牌指示牌</span><div>{ura.map((tile, index) => <TilePortrait key={`${index}-${tile}`} tile={tile} theme={theme} />)}</div></div>}
    {snapshot.round.wildcard && <div><span>百搭</span><div><TilePortrait tile={snapshot.round.wildcard} theme={theme} /></div></div>}
    {!!winner.flowers?.length && <div><span>花牌</span><div>{winner.flowers.map((tile, index) => <EvidenceTile key={`${index}-${tile}`} tile={tile} theme={theme} highlighted={evidence?.flowers?.includes(index)} />)}</div></div>}
    {!!winner.kita && <div><span>拔北</span><div>{Array.from({ length: winner.kita ?? 0 }, (_, index) => <EvidenceTile key={index} tile="z4" theme={theme} highlighted={evidence?.kita} />)}</div></div>}
  </div>;
}

function WinDetail({ winner, snapshot, theme, history, revealed, progress }: { winner: WinnerView; snapshot: GameSnapshot; theme: TableTheme; history: boolean; revealed: number; progress: number }) {
  const [selectedScoring, setSelectedScoring] = useState<{ index: number; evidence: ScoringEvidence } | null>(null);
  const scoringButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const evidenceId = useId();
  const selected = selectedScoring && selectedScoring.index < revealed ? selectedScoring : null;
  const mode = snapshot.mode ?? 'riichi';
  const player = snapshot.players.find(item => item.id === winner.playerId);
  const unit = snapshot.scoreUnit ?? (isJapanese(mode) ? '点' : '分');
  const kind = winner.fromId == null ? '自摸' : isJapanese(mode) ? '荣和' : '点和';
  const gain = actualGain(winner);
  const hasPayments = winner.payments?.length === snapshot.players.length;
  const sichuan = mode.startsWith('sichuan') ? winner.sichuanScore ?? {
    fanCap: 4, effectiveFan: Math.min(4, winner.han), multiplier: 2 ** Math.min(4, winner.han), selfDrawBonus: winner.fromId == null ? 1 : 0,
  } : null;

  return <article className="settlement-win-detail">
    <div className="settlement-winner-heading">
      <div className="settlement-winner-identity"><span className="settlement-wind">{player?.wind ?? '和'}</span><div><span className="settlement-kicker">{history ? '本局和牌记录' : '和牌者'}</span><h3>{player?.name ?? '和牌者'}{player?.isHuman && <small>你</small>}</h3><p>{kind}{winner.fromId != null ? ` · ${nameOf(snapshot, winner.fromId)}放铳` : ' · 摸入即和'}</p></div></div>
      <div className="settlement-winner-gain"><span>{hasPayments ? '本次实收' : '和牌得分'}</span><strong><ScoreNumber value={gain} progress={progress} signedValue /><small>{unit}</small></strong></div>
    </div>

    <WinTiles winner={winner} snapshot={snapshot} theme={theme} evidence={selected?.evidence} />
    <Indicators snapshot={snapshot} winner={winner} theme={theme} evidence={selected?.evidence} />

    <div className="settlement-detail-grid">
      <section className="settlement-yaku" aria-label="役与番种明细">
        <div className="settlement-section-label"><span>{isJapanese(mode) ? '役与宝牌' : '牌型与计分项'}</span></div>
        <ul>{winner.yaku.map((yaku, index) => {
          const open = selected?.index === index;
          return <li key={`${index}-${yaku.name}`} className={`${index < revealed ? 'yaku-revealed' : 'yaku-pending'} ${open ? 'yaku-selected' : ''}`}>
            <button type="button" className="settlement-yaku-button" ref={node => { scoringButtons.current[index] = node; }} disabled={index >= revealed} aria-expanded={open} aria-controls={open ? evidenceId : undefined} onClick={() => setSelectedScoring(open ? null : { index, evidence: explainScoringItem(winner, snapshot, index) })}>
              <span>{displayYakuName(yaku.name, mode)}</span><strong>{yakuValue(yaku, mode)}</strong><span className="settlement-yaku-toggle" aria-hidden="true">{open ? '−' : '+'}</span>
            </button>
            {open && selected && <div id={evidenceId} className="settlement-scoring-explanation"><p>{selected.evidence.text}</p><button type="button" aria-label="收起计分说明" onClick={() => { setSelectedScoring(null); scoringButtons.current[index]?.focus({ preventScroll: true }); }}>×</button></div>}
          </li>;
        })}</ul>
        {!winner.yaku.length && <p className="settlement-muted-copy">未记录独立计分项</p>}
      </section>
      <section className="settlement-value" aria-label="本次和牌点数">
        <div className="settlement-value-top">
          <div className={`settlement-han-seal ${winner.yakuman ? 'is-yakuman' : ''}`}>
            {winner.yakuman > 0 ? <><strong>{winner.yakuman > 1 ? winner.yakuman : ''}</strong><span>{winner.yakuman > 1 ? '倍役满' : '役满'}</span></> : <><strong>{format(winner.han)}</strong><span>{countedUnit(mode)}</span></>}
            {isJapanese(mode) && winner.fu > 0 && <small>{format(winner.fu)} 符</small>}
          </div>
          <div className="settlement-value-copy">{sichuan ? <><span>番数合计</span><p>{format(winner.han)} 番{typeof sichuan.fanCap === 'number' && sichuan.effectiveFan < winner.han ? ` · 按 ${format(sichuan.fanCap)} 番封顶` : ''} · {format(sichuan.multiplier)} 倍</p>{sichuan.selfDrawBonus > 0 && <p>自摸每家 +{format(sichuan.selfDrawBonus)} 底</p>}</> : <><span>{winner.yakuman > 0 ? '役满和牌' : pointModes.has(mode) ? '基础计分' : mode === 'taiwan' ? '台数合计' : '番数合计'}</span><p>{winner.yakuman > 0 ? '按本局役满结果结算' : isJapanese(mode) ? `${winner.fu > 0 ? `${format(winner.fu)} 符 · ` : ''}${format(winner.han)} 番` : `${format(winner.han)} ${countedUnit(mode)}`}</p></>}</div>
        </div>
        {hasPayments && <div className="settlement-payments"><div className="settlement-section-label"><span>本次分配</span><small>{unit}</small></div>{snapshot.players.map(item => {
          const value = winner.payments![item.id] ?? 0;
          return <div key={item.id}><span>{item.name}{item.isHuman && <small>你</small>}</span><strong className={changeClass(value)}><ScoreNumber value={value} progress={progress} signedValue /></strong></div>;
        })}</div>}
      </section>
    </div>
  </article>;
}

function TransferLedger({ snapshot, transfers }: { snapshot: GameSnapshot; transfers: RoundTransfer[] }) {
  const unit = snapshot.scoreUnit ?? (isJapanese(snapshot.mode ?? 'riichi') ? '点' : '分');
  const originalTransfers = new Map(transfers.map((transfer, index) => [transfer.id, { transfer, index }]));
  return <details className="settlement-transfers">
    <summary><span>逐笔收支</span><small>{transfers.length} 笔</small></summary>
    <ol>{transfers.map((transfer, index) => {
      const original = transfer.relatedId ? originalTransfers.get(transfer.relatedId) : undefined;
      return <li key={transfer.id}>
        <span className="settlement-transfer-number">{String(index + 1).padStart(2, '0')}</span>
        <div className="settlement-transfer-body">
          <div className="settlement-transfer-kind"><strong>{transferNames[transfer.kind]}</strong>{transfer.tile && <span>{tileName(transfer.tile)}</span>}{transfer.kind === 'win' && transfer.winIndex != null && <span>第 {transfer.winIndex + 1} 次和牌</span>}</div>
          <div className="settlement-transfer-route"><span>{nameOf(snapshot, transfer.from)}</span><span aria-label="转给">→</span><span>{nameOf(snapshot, transfer.to)}</span></div>
          {transfer.kind === 'kong-refund' && original && <small className="settlement-transfer-related">退回第 {original.index + 1} 笔 · {transferNames[original.transfer.kind]}</small>}
        </div>
        <strong className="settlement-transfer-amount">{format(transfer.amount)}<small>{unit}</small></strong>
      </li>;
    })}</ol>
  </details>;
}

function ScoreCards({ snapshot, result, progress }: { snapshot: GameSnapshot; result: RoundResult; progress: number }) {
  const isMatch = result.kind === 'match';
  const unit = snapshot.scoreUnit ?? (isJapanese(snapshot.mode ?? 'riichi') ? '点' : '分');
  const players = isMatch && result.ranks ? [...snapshot.players].sort((left, right) => result.ranks![left.id] - result.ranks![right.id]) : snapshot.players;
  return <section className="settlement-ledger" aria-label={isMatch ? '最终排名与分数' : '所有玩家结算明细'}>
    <div className="settlement-section-label"><span>{isMatch ? '最终排名' : '全桌收支'}</span><small>{isMatch ? '最终分数' : '本局累计'} · {unit}</small></div>
    <div className="settlement-score-cards" style={{ '--seat-count': players.length } as CSSProperties}>{players.map(player => {
      const after = result.scores[player.id] ?? player.points;
      const delta = result.deltas[player.id] ?? 0;
      const rank = result.ranks?.[player.id];
      const before = after - delta;
      const ready = result.tenpai?.[player.id];
      return <article key={player.id} className={`settlement-score-card ${player.isHuman ? 'is-you' : ''} ${isMatch && rank === 1 ? 'is-first' : ''}`}>
        <header><div><span className="settlement-seat-mark">{isMatch && rank ? `#${rank}` : player.wind}</span><strong>{player.name}</strong></div>{player.isHuman && <small>你</small>}</header>
        {isMatch ? <div className="settlement-final-points"><strong>{format(after)}</strong><small>{unit}</small></div> : <>
          <div className="settlement-score-before"><span title={isJapanese(snapshot.mode ?? 'riichi') ? '已扣除本局立直支出' : undefined}>变动前</span><b>{format(before)}</b></div>
          <div className={`settlement-score-change ${changeClass(delta)}`}><ScoreNumber value={delta} progress={progress} signedValue /><small>{unit}</small></div>
          <div className="settlement-score-after"><span>结算后</span><strong><ScoreNumber value={after} from={before} progress={progress} /></strong></div>
          {ready !== undefined && <span className={`settlement-ready ${ready ? 'is-ready' : ''}`}>{ready ? '听牌' : '未听牌'}</span>}
        </>}
      </article>;
    })}</div>
    {!!result.transfers?.length && <TransferLedger key={`${snapshot.revision}:${result.kind}`} snapshot={snapshot} transfers={result.transfers} />}
  </section>;
}

/** The same scoring presentation is available without settlement animation. */
export function ReplaySettlementDetails({ snapshot, theme, winners, result }: { snapshot: GameSnapshot; theme: TableTheme; winners: WinnerView[]; result: RoundResult | null }) {
  const [selected, setSelected] = useState(0);
  const selectedIndex = Math.min(selected, winners.length - 1);
  const winner = winners[selectedIndex];
  return <div className="replay-settlement-details">
    {winners.length > 1 && <nav className="replay-winner-tabs" aria-label="选择和牌记录">{winners.map((item, index) => <button type="button" key={index} aria-pressed={selectedIndex === index} onClick={() => setSelected(index)}>{nameOf(snapshot, item.playerId)} · {index + 1}</button>)}</nav>}
    {winner && <WinDetail key={`${snapshot.seed}:${snapshot.revision}:${snapshot.latestWin?.id ?? ''}:${selectedIndex}`} winner={winner} snapshot={snapshot} theme={theme} history revealed={winner.yaku.length} progress={1} />}
    {result && <ScoreCards snapshot={snapshot} result={result} progress={1} />}
  </div>;
}

function SettlementContent({ snapshot, theme, result, reducedMotion = false, onNext, onRestart, onLobby, onExport }: RoundSettlementProps & { result: RoundResult }) {
  const initialWinner = Math.max(0, result.winners.findIndex(winner => winner.playerId === snapshot.humanId));
  const [selected, setSelected] = useState(initialWinner);
  const panelRef = useRef<HTMLElement>(null);
  const titleId = useId();
  const mode = snapshot.mode ?? 'riichi';
  const playerNames = snapshot.players.map(player => player.name);
  const next = snapshot.actions.find(action => action.type === 'next');
  const winner = result.winners[selected] ?? result.winners[0];
  const isMatch = result.kind === 'match';
  const isDraw = result.kind === 'draw' || result.kind === 'abort';
  const unit = snapshot.scoreUnit ?? (isJapanese(mode) ? '点' : '分');
  const history = mode.startsWith('sichuan') && (result.winners.length > 1 || result.kind === 'draw');
  const presentationKey = `${selected}:${winner?.playerId ?? ''}`;
  const presentation = useSettlementPresentation(presentationKey, winner?.yaku.length ?? 0, !reducedMotion && !isMatch && !!winner && !history && !isDraw);
  const themeVariables = { '--surface': theme.ui.surface, '--panel': theme.ui.panel, '--raised': theme.ui.raised, '--cream': theme.ui.text, '--muted': theme.ui.muted, '--gold': theme.ui.accent, '--border-color': theme.ui.border, '--felt': theme.felt } as CSSProperties;

  useEffect(() => {
    const previous = document.activeElement;
    panelRef.current?.focus({ preventScroll: true });
    return () => { if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);

  function keepFocus(event: KeyboardEvent<HTMLElement>) {
    if (event.key === 'Escape' && !presentation.complete) { event.preventDefault(); presentation.skip(); return; }
    if (event.key !== 'Tab') return;
    const buttons = [...(panelRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), summary, [href], [tabindex="0"]') ?? [])].filter(element => element.getClientRects().length > 0);
    const first = buttons[0], last = buttons.at(-1);
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }

  return <div className="settlement-overlay" style={themeVariables}>
    <section className={`settlement-panel ${presentation.complete ? 'presentation-complete' : 'presentation-playing'}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={panelRef} onKeyDown={keepFocus}>
      <header className="settlement-header"><div><div className="settlement-kicker">{snapshot.modeName ?? getMode(snapshot.mode).name} <i /> {isMatch ? '对局结算' : `${snapshot.round.wind}${snapshot.round.hand}局`}</div><h2 id={titleId}>{displayScoringText(result.title, mode, playerNames)}</h2><p>{displayScoringText(result.description, mode, playerNames)}</p></div><span className={`settlement-outcome-mark ${isDraw ? 'is-draw' : ''}`} aria-hidden="true">{isMatch ? '终' : result.kind === 'abort' ? '止' : result.kind === 'draw' ? '流' : '和'}</span></header>

      <div className="settlement-scroll">
        {isDraw && <div className="settlement-draw-note"><strong>{result.kind === 'abort' ? '本局中途结束' : result.winners.length ? '牌山耗尽，本局结束' : '本局没有和牌'}</strong></div>}
        {result.winners.length > 1 && <div className="settlement-winner-picker"><div className="settlement-section-label"><span>{history ? '本局和牌记录' : '查看和牌者'}</span><small>共 {result.winners.length} 次和牌</small></div><div className="settlement-winner-tabs" role="group" aria-label="选择查看和牌明细">{result.winners.map((item, index) => <button type="button" key={`${item.playerId}-${index}`} aria-pressed={selected === index} className={selected === index ? 'is-selected' : ''} onClick={() => setSelected(index)}><span className="settlement-win-number">{String(index + 1).padStart(2, '0')}</span><span><strong>{nameOf(snapshot, item.playerId)}</strong><small>{item.fromId == null ? '自摸' : '荣和'}</small></span><b>{signed(actualGain(item))}<small>{unit}</small></b></button>)}</div></div>}
        {winner && <WinDetail key={presentationKey} winner={winner} snapshot={snapshot} theme={theme} history={history} revealed={presentation.revealed} progress={presentation.progress} />}
        <ScoreCards snapshot={snapshot} result={result} progress={presentation.progress} />

      </div>

      <footer className="settlement-footer"><div className="settlement-footer-secondary"><button type="button" onClick={onExport}>导出牌谱</button><button type="button" onClick={onLobby}>返回大厅</button></div><div className="settlement-footer-actions">{!isMatch && winner && !history && !isDraw && <button type="button" className="settlement-skip" onClick={presentation.skip} disabled={presentation.complete}>{presentation.complete ? '明细已展示' : '跳过动画'}{!presentation.complete && <kbd>Esc</kbd>}</button>}<button type="button" className="settlement-next" disabled={!isMatch && !next} onClick={isMatch ? onRestart : onNext}>{isMatch ? '再开一场' : next?.label ?? '继续下一局'}<Arrow /></button></div></footer>
    </section>
  </div>;
}

/** Complete settlement overlay. Advancing is always an explicit button action. */
export function RoundSettlement(props: RoundSettlementProps) {
  const result = props.snapshot.result;
  if (!result) return null;
  const key = `${props.snapshot.seed}:${props.snapshot.round.wind}:${props.snapshot.round.hand}:${props.snapshot.round.honba}:${result.kind}:${props.snapshot.latestWin?.id ?? ''}`;
  return <SettlementContent key={key} {...props} result={result} />;
}
