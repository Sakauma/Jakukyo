import { useCallback, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import type { ConfirmedWinEvent, GameSnapshot } from '../game/types';
import './winFeedback.css';

export interface WinFeedbackProps {
  event: ConfirmedWinEvent;
  snapshot: GameSnapshot;
  /** Also pass true when the user has turned decorative win effects off. */
  reduced: boolean;
  /** Closes this notice only; never dispatches an engine action. */
  onDone: () => void;
}

/** A brief, non-modal acknowledgment of an actual public win. Audio is owned by audio.sync. */
export function WinFeedback({ event, snapshot, reduced, onDone }: WinFeedbackProps) {
  const callback = useRef(onDone);
  const completedId = useRef('');
  callback.current = onDone;
  const duration = event.winners.length > 1 ? 1400 : 1150;
  const complete = useCallback(() => {
    if (completedId.current === event.id) return;
    completedId.current = event.id; callback.current();
  }, [event.id]);
  useEffect(() => {
    const timer = setTimeout(complete, duration);
    return () => clearTimeout(timer);
  }, [complete, duration]);

  if (!event.winners.length) return null;
  const selfDraw = event.winners.every(winner => winner.fromId == null);
  const japanese = snapshot.mode === 'riichi' || snapshot.mode === 'sanma' || !snapshot.mode;
  const title = selfDraw ? '自摸' : japanese ? '荣和' : '和牌';
  const multiple = event.winners.length > 1;
  const unit = snapshot.scoreUnit ?? (japanese ? '点' : '分');
  const amount = (value: number) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${value.toLocaleString('zh-CN', { maximumFractionDigits: 2 })}` : '—';

  return <aside key={event.id} className={`win-feedback${reduced ? ' win-feedback--reduced' : ''}${multiple ? ' win-feedback--multiple' : ''}`}
    style={{ '--feedback-duration': `${duration}ms` } as CSSProperties} role="status" aria-live="polite" aria-atomic="true">
    <div className="win-feedback-glow" aria-hidden="true" />
    <div className="win-feedback-card">
      <span className="win-feedback-sweep" aria-hidden="true" />
      <div className="win-feedback-heading">
        <span className="win-feedback-seal" aria-hidden="true">和</span>
        <div><p className="win-feedback-caption">{multiple ? `一炮${event.winners.length === 2 ? '双' : event.winners.length === 3 ? '三' : '多'}响` : '好牌成和'}</p><h2>{title}</h2></div>
        <span className="win-feedback-rule">{event.continuing ? '本局继续' : '本次收益'}</span>
      </div>
      <ul className="win-feedback-winners">
        {event.winners.map(winner => {
          const player = snapshot.players.find(item => item.id === winner.playerId);
          const gain = winner.payments?.[winner.playerId] ?? event.deltas[winner.playerId] ?? winner.points;
          const sichuan = snapshot.mode?.startsWith('sichuan') ? winner.sichuanScore ?? {
            fanCap: 4, effectiveFan: Math.min(4, winner.han), multiplier: 2 ** Math.min(4, winner.han), selfDrawBonus: winner.fromId == null ? 1 : 0,
          } : null;
          return <li key={winner.playerId}>
            <span className="win-feedback-name"><span className="win-feedback-wind">{player?.wind ?? '和'}</span>{player?.name ?? `玩家 ${winner.playerId + 1}`}{sichuan && <small>{winner.han} 番 · {sichuan.multiplier} 倍{typeof sichuan.fanCap === 'number' && sichuan.effectiveFan < winner.han ? '（封顶）' : ''}{sichuan.selfDrawBonus > 0 ? ` +${sichuan.selfDrawBonus} 底` : ''}</small>}</span>
            <span className="win-feedback-gain">{amount(gain)}<small>{unit}</small></span>
          </li>;
        })}
      </ul>
      <button type="button" className="win-feedback-dismiss" onClick={complete} aria-label={event.continuing ? '收起和牌提示' : '收起提示，查看结算'}>
        {event.continuing ? '收起提示' : '查看结算'}<span aria-hidden="true">→</span>
      </button>
    </div>
  </aside>;
}
