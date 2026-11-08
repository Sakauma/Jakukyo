import { useMemo } from 'react';
import type { GameSessionAPI, GameSnapshot, HandTile, RonNotice } from '../game/types';
import { TilePortrait } from '../table/TilePortrait';
import { tileName } from '../table/tileTextures';
import type { TableTheme } from '../table/themes';
import './riichiAssist.css';

interface Props {
  snapshot: GameSnapshot;
  session: GameSessionAPI | null;
  selectedTile?: HandTile;
  notice: RonNotice | null;
  theme: TableTheme;
  showDetails: boolean;
}

function shortReason(reason: string) {
  const mcrFan = reason.match(/^不足8番：当前非花牌番为(\d+)番/);
  if (mcrFan) return `不足8番 · 当前${mcrFan[1]}番`;
  const label = reason.split(/[：:，,。]/, 1)[0];
  return label === '定缺限制' ? '缺门未清' : label;
}

/** Regional previews describe hand shape; actual win eligibility comes from legal actions. */
export function RegionalAssistPanel({ snapshot, session, selectedTile, notice, theme, showDetails }: Props) {
  const mode = snapshot.mode ?? 'riichi';
  const japanese = mode === 'riichi' || mode === 'sanma';
  const human = snapshot.players.find(player => player.isHuman);
  const wonBloodBattle = mode === 'sichuan-blood' && !!human?.hasWon;
  const winAction = snapshot.actions.find(action => action.type === 'ron' || action.type === 'tsumo');
  const preview = useMemo(() => {
    if (japanese || snapshot.status !== 'playing' || snapshot.phase !== 'discard' || wonBloodBattle || winAction || !selectedTile) return null;
    if (!human?.hand.some(tile => tile.id === selectedTile.id && tile.tile === selectedTile.tile)) return null;
    if (!snapshot.actions.some(action => action.type === 'discard' && action.tileId === selectedTile.id)) return null;
    return session?.getRegionalHint?.(selectedTile.id) ?? null;
  }, [session, snapshot, selectedTile?.id, japanese, wonBloodBattle, winAction]);

  if (japanese || snapshot.status !== 'playing' || snapshot.phase === 'exchange' || snapshot.phase === 'void' || !human) return null;
  const distance = preview ? preview.shanten : snapshot.shanten;
  const waits = preview?.waits ?? snapshot.waits;
  const title = preview && selectedTile ? `打出${tileName(selectedTile.tile)}后` : '当前手牌';
  const ready = distance === 0 && waits.length > 0;
  const selfNotice = snapshot.selfWinNotice;
  const reasons = (selfNotice?.reasons ?? notice?.reasons ?? []).map(shortReason).filter(Boolean);
  const reasonStatus = `${selfNotice ? '本次自摸 · ' : notice?.active ? '' : '刚才 · '}${[...new Set(reasons)].join(' · ')}`;
  const rule = mode === 'mcr' ? '8番起和（不含花牌）' : mode === 'hongkong' ? '3番起和'
    : mode === 'hangzhou' ? '自摸或抢杠' : mode === 'wuhan' ? '赖子手仅自摸' : '';
  const voidTiles = mode.startsWith('sichuan') && human.voidSuit ? human.hand.filter(tile => tile.tile[0] === human.voidSuit) : [];
  const clearsVoid = !!preview && !!selectedTile && voidTiles.length === 1 && selectedTile.tile[0] === human.voidSuit;
  const voidStatus = !wonBloodBattle && !winAction && voidTiles.length ? clearsVoid ? '打出后缺门清除' : '缺门未清 · 不能碰杠和' : '';
  let status: string;
  if (winAction) status = winAction.type === 'tsumo' ? '可以自摸' : winAction.label.includes('抢杠') ? '可以抢杠和牌' : '可以和牌';
  else if (wonBloodBattle) status = '已和牌';
  else if (reasons.length && !preview) status = reasonStatus;
  else if (ready) status = '牌形听牌';
  else if (distance === -1) status = '牌形已成';
  else if (distance != null && distance > 0) status = '未听牌';
  else if (snapshot.phase === 'discard' && !preview) status = '选牌查看';
  else status = '暂无听张';

  const heading = winAction ? '和牌机会' : ready ? '听张' : distance != null && distance > 0 ? `${distance} 向听` : '';
  const displayedWaits = showDetails && !winAction && !wonBloodBattle ? waits : [];
  return <section className={`riichi-assist ${displayedWaits.length > 6 ? 'has-many-waits' : ''} ${reasons.length && !winAction ? 'has-furiten' : ''}`} aria-label="和牌与听牌提示">
    <div className="assist-summary"><span>{title}</span>{showDetails && heading && <strong>{heading}</strong>}</div>
    <div className={`assist-status ${winAction ? 'has-yaku' : ''} ${reasons.length && !winAction || voidStatus ? 'is-furiten' : ''}`} aria-label="和牌资格"><strong>{status}</strong>{preview && reasons.length > 0 && !winAction && <span>{reasonStatus}</span>}{voidStatus && <span>{voidStatus}</span>}{rule && <span className="regional-rule">{rule}</span>}</div>
    {displayedWaits.length > 0 && <div className="assist-wait-area"><ul className="assist-waits" aria-label="牌形听张">{displayedWaits.map(tile =>
      <li key={tile} title={tileName(tile)}><TilePortrait tile={tile} theme={theme} /><span><em>{tileName(tile)}</em></span></li>
    )}</ul></div>}
  </section>;
}
