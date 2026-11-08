import { useEffect, useState } from 'react';
import type { GameSnapshot, LegalAction, RonNotice } from '../game/types';
import { tileName } from '../table/tileTextures';
import './responseFeedback.css';

const RECENT_NOTICE_MS = 8000;
type NoticeSnapshot = Pick<GameSnapshot, 'status' | 'actions' | 'mode' | 'seed' | 'round' | 'ronNotice'>;
export interface RetainedRonFeedback {
  notice: RonNotice;
  roundKey: string;
  sessionKey: unknown;
  expiresAt: number | null;
}

function roundKey(snapshot: NoticeSnapshot) {
  return JSON.stringify([snapshot.mode, snapshot.seed, snapshot.round.wind, snapshot.round.hand, snapshot.round.honba, snapshot.round.dealer, snapshot.round.sequence]);
}

function canWin(snapshot: NoticeSnapshot) {
  return snapshot.actions.some(action => action.type === 'ron' || action.type === 'tsumo');
}

/** Only retains an engine explanation; it never infers legality from hand shape or AI hints. */
export function retainRonFeedback(previous: RetainedRonFeedback | null, snapshot: NoticeSnapshot | null, sessionKey: unknown, now: number): RetainedRonFeedback | null {
  if (!snapshot || snapshot.status !== 'playing' || canWin(snapshot)) return null;
  const scope = roundKey(snapshot);
  const current = previous?.roundKey === scope && previous.sessionKey === sessionKey ? previous : null;
  const notice = snapshot.ronNotice;
  if (notice?.reasons.length) {
    return { notice, roundKey: scope, sessionKey, expiresAt: notice.active ? null
      : current?.notice.id === notice.id && current.expiresAt != null ? current.expiresAt : now + RECENT_NOTICE_MS };
  }
  if (!current) return null;
  return current.expiresAt == null ? { ...current, notice: { ...current.notice, active: false }, expiresAt: now + RECENT_NOTICE_MS } : current;
}

export function visibleRonFeedback(retained: RetainedRonFeedback | null, snapshot: NoticeSnapshot | null, sessionKey: unknown, now: number): RonNotice | null {
  if (!snapshot || snapshot.status !== 'playing' || canWin(snapshot)) return null;
  if (snapshot.ronNotice?.active && snapshot.ronNotice.reasons.length) return snapshot.ronNotice;
  if (!retained || retained.sessionKey !== sessionKey || retained.roundKey !== roundKey(snapshot)
    || retained.expiresAt != null && now >= retained.expiresAt) return null;
  return { ...retained.notice, active: false };
}

export function useRonFeedback(snapshot: GameSnapshot | null, sessionKey: unknown) {
  const [retained, setRetained] = useState<RetainedRonFeedback | null>(null);
  const [, tick] = useState(0);
  const scope = snapshot ? roundKey(snapshot) : null;
  const winning = snapshot ? canWin(snapshot) : false;
  useEffect(() => {
    setRetained(previous => retainRonFeedback(previous, snapshot, sessionKey, Date.now()));
  }, [sessionKey, scope, snapshot?.status, snapshot?.ronNotice?.id, snapshot?.ronNotice?.active, winning]);
  useEffect(() => {
    if (retained?.expiresAt == null) return;
    const timeout = setTimeout(() => tick(value => value + 1), Math.max(0, retained.expiresAt - Date.now()));
    return () => clearTimeout(timeout);
  }, [retained?.expiresAt]);
  return visibleRonFeedback(retained, snapshot, sessionKey, Date.now());
}

export function ResponseFeedback({ winAction, notice, players, onHelp, helpLabel }: {
  winAction?: LegalAction;
  notice: RonNotice | null;
  players: ReadonlyArray<{ id: number; name: string }>;
  onHelp: () => void;
  helpLabel: string;
}) {
  if (winAction) return <div className="response-feedback response-feedback-allowed" role="status" aria-live="polite">
    <strong>可以{winAction.label}</strong>
  </div>;
  if (!notice) return null;
  const from = players.find(player => player.id === notice.fromId)?.name ?? '对手';
  return <div className="response-feedback response-feedback-blocked" role="status" aria-live="polite">
    <div className="response-feedback-heading"><span>{notice.active ? '' : '刚才 · '}{from}{notice.event === 'addedKan' ? '补杠' : '打出'}{tileName(notice.tile)}</span></div>
    <div className="response-feedback-reasons">{notice.reasons.map(reason => <p key={reason}>{reason}</p>)}</div>
    <button type="button" className="response-help" onClick={onHelp}>{helpLabel} →</button>
  </div>;
}
