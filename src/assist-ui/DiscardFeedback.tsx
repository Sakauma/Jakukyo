import { useEffect, useState } from 'react';
import type { GameSnapshot } from '../game/types';
import { createDiscardFeedbackTracker, discardFeedbackScope } from '../presentation/discardFeedback';
import type { DiscardFeedbackEvent } from '../presentation/discardFeedback';
import { TilePortrait } from '../table/TilePortrait';
import { tileName } from '../table/tileTextures';
import type { TableTheme } from '../table/themes';
import './discardFeedback.css';

/** A brief public action cue. Audio remains owned by the shared table timeline. */
export function DiscardFeedback({ snapshot, sessionKey, theme, reducedMotion }: {
  snapshot: GameSnapshot | null;
  sessionKey: unknown;
  theme: TableTheme;
  reducedMotion: boolean;
}) {
  const [tracker] = useState(createDiscardFeedbackTracker);
  const [event, setEvent] = useState<DiscardFeedbackEvent | null>(null);
  useEffect(() => {
    setEvent(tracker.sync(snapshot, sessionKey, Date.now(), document.hidden));
  }, [snapshot, sessionKey, tracker]);
  useEffect(() => {
    if (!event) return;
    const timer = setTimeout(() => setEvent(null), Math.max(0, event.expiresAt - Date.now()));
    return () => clearTimeout(timer);
  }, [event]);
  useEffect(() => {
    const clearHidden = () => {
      if (document.hidden) {
        tracker.sync(null, null, Date.now(), true);
        setEvent(null);
      }
    };
    document.addEventListener('visibilitychange', clearHidden);
    return () => document.removeEventListener('visibilitychange', clearHidden);
  }, [tracker]);

  if (!event || !snapshot || snapshot.status !== 'playing' || event.sessionKey !== sessionKey
    || event.scope !== discardFeedbackScope(snapshot) || Date.now() >= event.expiresAt) return null;
  return <aside key={event.key} className={`discard-feedback ${reducedMotion ? 'is-reduced' : ''}`}
    role="status" aria-label={`${event.playerName}打出${tileName(event.tile)}`}>
    <TilePortrait tile={event.tile} theme={theme} />
    <div><strong>{event.playerName}</strong><span>{tileName(event.tile)}</span></div>
  </aside>;
}
