import type { GameSnapshot, HandTile, RiichiFuritenReason } from '../game/types';
import { TilePortrait } from '../table/TilePortrait';
import { tileName } from '../table/tileTextures';
import type { TableTheme } from '../table/themes';
import './riichiAssist.css';

interface Props {
  snapshot: GameSnapshot;
  selectedTile?: HandTile;
  riichiMode: boolean;
  theme: TableTheme;
  showDetails?: boolean;
}

const furitenNames: Record<RiichiFuritenReason, string> = {
  discard: '舍牌振听', temporary: '同巡振听', 'riichi-pass': '立直后振听',
};

/** This component receives only the engine's public-information hint view. */
export function RiichiAssistPanel({ snapshot, selectedTile, riichiMode, theme, showDetails = true }: Props) {
  const assist = snapshot.riichiAssist;
  if (!assist || snapshot.status !== 'playing' || !['riichi', 'sanma'].includes(snapshot.mode ?? 'riichi')) return null;
  const legalWin = snapshot.actions.find(action => action.type === 'ron' || action.type === 'tsumo');
  const preview = !legalWin && selectedTile ? assist.discards[selectedTile.id] : undefined;
  const hint = preview ?? assist.current;
  const furiten = hint?.furiten ?? assist.furiten;
  const waits = hint?.waits ?? [];
  const title = preview && selectedTile ? `打出${tileName(selectedTile.tile)}后` : '当前手牌';
  const distance = hint?.shanten ?? snapshot.shanten;
  const ready = distance === 0 && waits.length > 0;
  const canDeclare = !preview && snapshot.actions.some(action => action.type === 'riichi');
  const readyDiscard = !hint && Object.values(assist.discards).some(discard => discard.shanten === 0 && discard.waits.length > 0);
  const heading = legalWin ? '和牌机会' : ready ? '听牌' : distance === -1 ? '和牌形'
    : readyDiscard ? '出牌后听牌' : distance != null && distance > 0 ? `${distance} 向听` : '';
  const visibleHeading = showDetails || legalWin || ready || distance === -1 ? heading : '';
  const declaredYaku = !!preview?.riichiEligible && riichiMode;
  const yakuCount = waits.filter(wait => wait.ronYaku).length;
  const alreadyDeclared = snapshot.players.find(player => player.isHuman)?.riichi;
  const yakuStatus = ready ? declaredYaku && yakuCount < waits.length ? '立直后有役'
    : yakuCount === waits.length ? alreadyDeclared ? '已立直 · 有役' : '有役'
      : yakuCount > 0 ? '部分听张有役' : preview?.riichiEligible ? '荣和无役 · 可立直' : '荣和无役'
    : distance === -1 ? '役待定' : canDeclare ? '可立直 · 选择宣言牌'
      : readyDiscard ? '役待定 · 选牌查看'
        : distance != null && distance > 0 ? '未听牌 · 役待定' : '役待定 · 选牌查看';
  const positive = !!legalWin || ready && (yakuCount > 0 || declaredYaku);
  const blocked = !legalWin && furiten.active;
  const displayedWaits = showDetails && !legalWin ? waits : [];
  const totalUnseen = displayedWaits.reduce((total, wait) => total + wait.unseen, 0);

  const denseWaits = displayedWaits.length > 6;
  return <section className={`riichi-assist ${denseWaits ? 'has-many-waits' : ''} ${blocked ? 'has-furiten' : ''}`} aria-label="和牌资格与听牌提示">
    <div className="assist-summary"><span>{title}</span>{visibleHeading && <strong>{visibleHeading}{displayedWaits.length > 0 && ` · 共${totalUnseen}张`}</strong>}</div>
    <div className={`assist-status ${positive ? 'has-yaku' : ''} ${blocked ? 'is-furiten' : ''}`} aria-label="和牌资格">
      <strong>{legalWin ? legalWin.type === 'tsumo' ? '可以自摸' : '可以荣和' : yakuStatus}</strong>
      {blocked && <span>{furiten.reasons.map(reason => furitenNames[reason]).join(' · ') || '振听'} · 不能荣和</span>}
    </div>
    {displayedWaits.length > 0 && <div className="assist-wait-area">
      <ul className="assist-waits" aria-label="牌形听张与公开未见数">{displayedWaits.map(wait => {
        const yakuLabel = wait.ronYaku ? '有役' : declaredYaku ? '立直后有役' : '无役';
        return <li key={wait.tile} className={`${wait.unseen === 0 ? 'is-exhausted' : ''} ${wait.ronYaku || declaredYaku ? 'has-yaku' : ''}`}
          title={`${tileName(wait.tile)} · 未见 ${wait.unseen} 张 · ${yakuLabel}`}>
          <TilePortrait tile={wait.tile} theme={theme} /><span><b>×{wait.unseen}</b><em>{denseWaits && declaredYaku && !wait.ronYaku ? '立直' : yakuLabel}</em></span>
        </li>;
      })}</ul>
    </div>}
  </section>;
}
