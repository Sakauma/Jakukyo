import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties } from 'react';
import { MODES, getMode } from '../game/catalog';
import { buildReplayFrames } from '../game/replay';
import type { ReplayFrame } from '../game/replay';
import type { GameSnapshot } from '../game/types';
import MahjongTable from '../table/MahjongTable';
import { TilePortrait } from '../table/TilePortrait';
import { tableSeat } from '../table/themes';
import type { TableTheme } from '../table/themes';
import { deleteRecord, exportRecordJson, getRecordsError, importRecordJson, listRecords, renameRecord, subscribeRecords, toggleFavorite } from '../records/store';
import type { GameRecord } from '../records/types';
import { displayScoringText } from '../presentation/scoringText';
import './replay.css';

const dateText = (value: string) => new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const recordStatus = (record: GameRecord) => record.completed ? '已完成' : record.save.matchLength === 'endless' && record.rounds.length ? '已结算' : '未完记录';
function exportFile(record: GameRecord) {
  const blob = new Blob([exportRecordJson(record.id)], { type: 'application/json' }), url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `${record.title.replace(/[<>:"/\\|?*]/g, '-')}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ReplayViewer({ record, theme, onBack }: { record: GameRecord; theme: TableTheme; onBack: () => void }) {
  const [frames, setFrames] = useState<ReplayFrame[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [index, setIndex] = useState(0), [playing, setPlaying] = useState(false), [speed, setSpeed] = useState(1);
  const [showHands, setShowHands] = useState(false), [view, setView] = useState<'perspective' | 'overhead'>('perspective');
  const [failed3D, setFailed3D] = useState(false);
  useEffect(() => {
    let stopped = false;
    setLoading(true); setError(''); setFrames([]); setIndex(0); setPlaying(false); setShowHands(false);
    buildReplayFrames(record.save).then(result => { if (!stopped) { setFrames(result); setLoading(false); } })
      .catch(reason => { if (!stopped) { setLoading(false); setError(reason instanceof Error ? reason.message : '这份牌谱暂时无法重建。'); } });
    return () => { stopped = true; };
  }, [record.id]);
  useEffect(() => {
    if (!playing || !frames.length) return;
    const timer = setInterval(() => setIndex(current => {
      if (current >= frames.length - 1) { setPlaying(false); return current; }
      return current + 1;
    }), 800 / speed);
    return () => clearInterval(timer);
  }, [playing, frames.length, speed]);
  const frame = frames[index];
  useEffect(() => { setShowHands(false); }, [frame?.roundKey]);
  const rounds = useMemo(() => {
    const entries: Array<{ key: string; index: number; label: string }> = [];
    frames.forEach((item, at) => { if (entries.at(-1)?.key !== item.roundKey) entries.push({ key: item.roundKey, index: at, label: `${item.snapshot.round.wind}${item.snapshot.round.hand}局 · ${item.snapshot.round.honba}本场` }); });
    return entries;
  }, [frames]);
  const roundIndex = rounds.findIndex(round => round.key === frame?.roundKey);
  const snapshot = useMemo<GameSnapshot | null>(() => frame ? {
    ...frame.snapshot, actions: [], autoPlay: false, latestWin: undefined,
    players: frame.snapshot.players.map(player => ({ ...player, revealedHand: showHands && frame.allHands ? frame.allHands[player.id] : undefined })),
  } : null, [frame, showHands]);
  const playerNames = snapshot?.players.map(player => player.name) ?? [];
  const go = (target: number) => { setPlaying(false); setIndex(Math.max(0, Math.min(frames.length - 1, target))); };

  return <div className="replay-viewer">
    <div className="replay-view-heading"><button type="button" onClick={onBack}>← 牌谱库</button><div><span className="replay-label">回放</span><h3>{record.title}</h3></div><button type="button" onClick={() => exportFile(record)}>导出 JSON</button></div>
    {loading ? <div className="replay-empty" role="status"><strong>正在还原这场对局…</strong></div> : error ? <div className="replay-empty" role="alert"><strong>未能打开牌谱</strong><p>{error}</p></div> : snapshot && frame ? <>
      <div className="replay-main">
        <div className="replay-board" aria-label="牌谱三维回放">
          <MahjongTable snapshot={snapshot} selectedId={null} interactiveIds={[]} onSelect={() => {}} view={view} theme={theme} reducedMotion onFailure={() => setFailed3D(true)} onRestore={() => setFailed3D(false)} />
          <div className="replay-board-badge">回放 · {snapshot.round.wind}{snapshot.round.hand}局 · 余 {snapshot.round.tilesLeft}</div>
          {snapshot.players.map(player => <div key={player.id} className={`replay-seat replay-seat-${tableSeat(player.id, snapshot.players.length)}`}><b>{player.wind} · {player.name}</b><span>{player.points.toLocaleString()} {snapshot.scoreUnit ?? '点'}</span></div>)}
          {failed3D && <div className="replay-webgl-error">3D 画面暂不可用，请关闭本页后重新打开。</div>}
          <button className="replay-view-toggle" type="button" onClick={() => setView(view === 'perspective' ? 'overhead' : 'perspective')}>{view === 'perspective' ? '俯视牌桌' : '透视牌桌'}</button>
        </div>
        <aside className="replay-detail">
          <span className="replay-label">当前动作</span><p className="replay-action" aria-live="polite">{displayScoringText(frame.actionLabel || snapshot.message, snapshot.mode, playerNames)}</p>
          <dl><div><dt>玩法</dt><dd>{getMode(record.mode).name}</dd></div><div><dt>对局进度</dt><dd>{index + 1} / {frames.length} 步</dd></div><div><dt>记录状态</dt><dd>{recordStatus(record)}</dd></div></dl>
          <label className="replay-reveal" title={frame.allHands ? undefined : '本局结束后可查看'}><input type="checkbox" checked={showHands && !!frame.allHands} disabled={!frame.allHands} onChange={event => setShowHands(event.target.checked)} />查看各家手牌</label>
          
          {!!snapshot.round.doraIndicators.length && <div className="replay-dora"><span>宝牌指示牌</span><div>{snapshot.round.doraIndicators.map((tile, at) => <TilePortrait key={at} tile={tile} theme={theme} />)}</div></div>}
          {snapshot.result && <div className="replay-result"><strong>{displayScoringText(snapshot.result.title, snapshot.mode, playerNames)}</strong><p>{displayScoringText(snapshot.result.description, snapshot.mode, playerNames)}</p>{snapshot.result.winners.map((winner, at) => <p key={at}>{snapshot.players.find(player => player.id === winner.playerId)?.name} · {winner.han ? `${winner.han} 番` : ''}{winner.fu ? ` ${winner.fu} 符` : ''} · {winner.points.toLocaleString()} {snapshot.scoreUnit ?? '点'}</p>)}</div>}
        </aside>
      </div>
      <footer className="replay-controls">
        <label className="replay-progress"><span>回放进度</span><input aria-label="回放进度" type="range" min="0" max={Math.max(0, frames.length - 1)} value={index} onChange={event => go(Number(event.target.value))} /><output>{index + 1} / {frames.length}</output></label>
        <div className="replay-transport"><button type="button" disabled={roundIndex <= 0} onClick={() => go(rounds[roundIndex - 1].index)}>上一局</button><button type="button" disabled={index <= 0} onClick={() => go(index - 1)}>上一动作</button><button className="replay-play" type="button" onClick={() => { if (index === frames.length - 1) setIndex(0); setPlaying(!playing); }}>{playing ? '暂停回放' : '播放回放'}</button><button type="button" disabled={index >= frames.length - 1} onClick={() => go(index + 1)}>下一动作</button><button type="button" disabled={roundIndex < 0 || roundIndex >= rounds.length - 1} onClick={() => go(rounds[roundIndex + 1].index)}>下一局</button><label>速度<select aria-label="回放速度" value={speed} onChange={event => setSpeed(Number(event.target.value))}>{[.5, 1, 2, 4].map(value => <option value={value} key={value}>{value}×</option>)}</select></label></div>
      </footer>
    </> : <div className="replay-empty">牌谱没有可回看的动作。</div>}
  </div>;
}

/** Own overlay: render directly from App, outside the generic experience panel. */
export function ReplayLibrary({ theme, onClose }: { theme: TableTheme; onClose: () => void }) {
  const records = useSyncExternalStore(subscribeRecords, listRecords, listRecords);
  const [selected, setSelected] = useState<GameRecord | null>(null), [mode, setMode] = useState('all'), [source, setSource] = useState('all'), [favorites, setFavorites] = useState(false);
  const [busy, setBusy] = useState(false), [notice, setNotice] = useState(''), [renaming, setRenaming] = useState<string | null>(null), [name, setName] = useState(''), [deleting, setDeleting] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null), container = useRef<HTMLElement>(null);
  useEffect(() => { container.current?.focus(); }, []);
  const filtered = records.filter(record => (mode === 'all' || record.mode === mode) && (source === 'all' || record.source === source) && (!favorites || record.favorite));
  const variables = { '--surface': theme.ui.surface, '--panel': theme.ui.panel, '--raised': theme.ui.raised, '--cream': theme.ui.text, '--muted': theme.ui.muted, '--gold': theme.ui.accent, '--border-color': theme.ui.border, '--felt': theme.felt } as CSSProperties;
  const attempt = (action: () => void) => { try { action(); } catch (reason) { setNotice(reason instanceof Error ? reason.message : '操作未能完成。'); } };
  async function importFile(selectedFile?: File) {
    if (!selectedFile) return;
    if (selectedFile.size > 5 * 1024 * 1024) { setNotice('文件超过 5 MB，请选择单场导出的 JSON。'); return; }
    setBusy(true); setNotice('');
    try { const record = await importRecordJson(await selectedFile.text()); setNotice(`已导入“${record.title}”。导入牌谱不计入本人实战战绩。`); }
    catch (reason) { setNotice(reason instanceof Error ? reason.message : '导入失败，请确认这是雀境导出的 JSON。'); }
    finally { setBusy(false); if (file.current) file.current.value = ''; }
  }

  return <div className={`replay-overlay theme-${theme.id}`} style={variables}>
    <section ref={container} tabIndex={-1} className={`replay-shell ${selected ? 'is-viewer' : ''}`} role="dialog" aria-modal="true" aria-label={selected ? '牌谱回放' : '本地牌谱库'} onKeyDown={event => { if (event.key === 'Escape') { event.stopPropagation(); if (selected) setSelected(null); else onClose(); } }}>
      <header className="replay-header"><div><h2>{selected ? '重温一局' : '本地牌谱库'}</h2></div><button className="replay-close" type="button" aria-label="关闭牌谱库" onClick={onClose}>×</button></header>
      {selected ? <ReplayViewer record={selected} theme={theme} onBack={() => setSelected(null)} /> : <>
        <div className="replay-library-tools"><span>最近 50 场 · 收藏保留</span><button className="replay-import" type="button" disabled={busy} onClick={() => file.current?.click()}>{busy ? '正在还原牌谱…' : '导入 JSON'}</button><input ref={file} className="replay-file" type="file" accept="application/json,.json" aria-label="导入雀境牌谱" onChange={event => { void importFile(event.target.files?.[0]); }} /></div>
        <div className="replay-filters"><label>玩法<select aria-label="牌谱玩法筛选" value={mode} onChange={event => setMode(event.target.value)}><option value="all">全部玩法</option>{MODES.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label>来源<select aria-label="牌谱来源筛选" value={source} onChange={event => setSource(event.target.value)}><option value="all">全部记录</option><option value="played">我的对局</option><option value="imported">导入牌谱</option></select></label><label className="replay-only-favorites"><input type="checkbox" checked={favorites} onChange={event => setFavorites(event.target.checked)} />只看收藏</label><span>{filtered.length} 场</span></div>
        {(notice || getRecordsError()) && <p className="replay-notice" role="status">{notice || getRecordsError()}</p>}
        <div className="replay-records">{filtered.length ? filtered.map(record => <article className="replay-record" key={record.id}>
          <div className="replay-record-main">{renaming === record.id ? <form onSubmit={event => { event.preventDefault(); attempt(() => { renameRecord(record.id, name); setRenaming(null); }); }}><input aria-label="牌谱名称" value={name} onChange={event => setName(event.target.value)} maxLength={60} autoFocus /><button type="submit">保存名称</button><button type="button" onClick={() => setRenaming(null)}>取消</button></form> : <h3>{record.title}</h3>}<p>{getMode(record.mode).name} · {record.playerCount} 人 · {dateText(record.createdAt)}</p><div className="replay-record-tags"><span>{record.source === 'played' ? '本人实战' : '导入'}</span><span>{recordStatus(record)}</span><span>{record.rounds.length} 局已结算</span>{record.completed && record.finalRanks?.[0] && <span>第 {record.finalRanks[0]} 名</span>}</div></div>
          <div className="replay-record-actions"><button className="replay-open" type="button" onClick={() => setSelected(record)}>打开回放</button><button type="button" aria-label={`${record.favorite ? '取消收藏' : '收藏'} ${record.title}`} aria-pressed={record.favorite} onClick={() => attempt(() => toggleFavorite(record.id))}>{record.favorite ? '★ 已收藏' : '☆ 收藏'}</button><button type="button" onClick={() => { setRenaming(record.id); setName(record.title); }}>命名</button><button type="button" onClick={() => attempt(() => exportFile(record))}>导出</button><button type="button" onClick={() => setDeleting(deleting === record.id ? null : record.id)}>删除</button></div>
          {deleting === record.id && <div className="replay-delete-confirm"><span>删除这份牌谱？</span><button type="button" onClick={() => { attempt(() => deleteRecord(record.id)); setDeleting(null); }}>确认删除</button><button type="button" onClick={() => setDeleting(null)}>保留</button></div>}
        </article>) : <div className="replay-empty"><strong>{records.length ? '没有符合筛选条件的牌谱' : '暂无牌谱'}</strong></div>}</div>
      </>}
    </section>
  </div>;
}
