import Majiang from '@kobalab/majiang-core';
import type { GameSnapshot, HandTile, LegalAction, MeldView, RiichiAssistView, RiichiHandHint } from '../types';
import { coreHand, norm, tileIndex } from '../variants/tiles';
import { furitenView } from './furiten';
import type { MissedWinState } from './furiten';

interface PublicSeat {
  id: number; wind: string; riichi: boolean;
  discards: { tile: string; called: boolean }[];
  melds: MeldView[];
  kita: number;
}
/** Deliberately has no opponent hands, seed, wall, scores, ura or engine references. */
export interface RiichiAssistInput {
  mode: 'riichi' | 'sanma'; ownId: number; ownHand: HandTile[];
  players: PublicSeat[]; roundWind: string; doraIndicators: string[];
  actions: Pick<LegalAction, 'type' | 'tileId'>[];
}

export function projectRiichiAssist(snapshot: GameSnapshot): RiichiAssistInput | undefined {
  if (snapshot.status !== 'playing' || !['riichi', 'sanma'].includes(snapshot.mode ?? 'riichi')) return undefined;
  return {
    mode: snapshot.mode === 'sanma' ? 'sanma' : 'riichi', ownId: snapshot.humanId,
    ownHand: snapshot.players.find(player => player.id === snapshot.humanId)?.hand.map(tile => ({ ...tile })) ?? [],
    players: snapshot.players.map(player => ({ id: player.id, wind: player.wind, riichi: player.riichi,
      discards: player.discards.map(({ tile, called }) => ({ tile, called })),
      melds: player.melds.map(meld => ({ ...meld, tiles: [...meld.tiles] })), kita: player.kita ?? 0,
    })),
    roundWind: snapshot.round.wind, doraIndicators: [...snapshot.round.doraIndicators],
    actions: snapshot.actions.map(({ type, tileId }) => ({ type, tileId })),
  };
}

const rule = Majiang.rule();
const winds = ['东', '南', '西', '北'];
const noMiss: MissedWinState = { temporary: false, riichiPass: false };

/** A one-entry cache is sufficient: snapshots update only on actions, not animation frames. */
export function createRiichiAssistCalculator() {
  let previousKey = '';
  let previousValue: RiichiAssistView | undefined;
  return (input: RiichiAssistInput | undefined, missed: MissedWinState = noMiss): RiichiAssistView | undefined => {
    if (!input) { previousKey = ''; previousValue = undefined; return undefined; }
    const key = JSON.stringify([input, missed]);
    if (key === previousKey) return previousValue;
    const human = input.players.find(player => player.id === input.ownId);
    if (!human) return undefined;
    const shown = new Map<string, number>();
    const add = (tile: string) => {
      if (!/^[mpsz][0-9]/.test(tile)) return;
      const normalized = norm(tile); shown.set(normalized, (shown.get(normalized) ?? 0) + 1);
    };
    input.ownHand.forEach(tile => add(tile.tile));
    input.players.forEach(player => {
      // A called river tile is physically in a meld, and therefore counted there only.
      player.discards.filter(discard => !discard.called).forEach(discard => add(discard.tile));
      player.melds.forEach(meld => meld.tiles.forEach(add));
      for (let n = 0; n < player.kita; n++) add('z4');
    });
    input.doraIndicators.forEach(add);
    const ownDiscards = human.discards.map(discard => discard.tile);
    const ownMeldTiles = human.melds.flatMap(meld => meld.tiles);
    const makeHint = (tiles: string[], discarded?: string): RiichiHandHint => {
      const hand = coreHand(tiles, human.melds);
      const distance: number = Majiang.Util.xiangting(hand);
      const waits: string[] = distance === 0 && tiles.length % 3 === 1
        ? [...new Set<string>((Majiang.Util.tingpai(hand) ?? []).map(norm))]
          .filter(tile => !(input.mode === 'sanma' && /^m[2-8]$/.test(tile)))
          .filter(tile => [...tiles, ...ownMeldTiles].filter(own => norm(own) === tile).length < 4)
          .sort((a, b) => tileIndex(a) - tileIndex(b)) : [];
      // Moving the hypothetical discard from hand to river does not change shown counts.
      const futureMissed = discarded && input.mode === 'riichi' && !human.riichi ? { ...missed, temporary: false } : missed;
      return {
        shanten: Number.isFinite(distance) ? distance : null,
        waits: waits.map(tile => ({ tile, unseen: Math.max(0, Math.min(4, 4 - (shown.get(tile) ?? 0))),
          ronYaku: Boolean(Majiang.Game.allow_hule(rule, hand, `${tile}+`, Math.max(0, winds.indexOf(input.roundWind)), Math.max(0, winds.indexOf(human.wind)), human.riichi, true)),
        })),
        furiten: furitenView(waits, discarded ? [...ownDiscards, discarded] : ownDiscards, futureMissed),
      };
    };
    const current = input.ownHand.length % 3 === 1 ? makeHint(input.ownHand.map(tile => tile.tile)) : null;
    const discards: Record<string, RiichiHandHint> = {};
    const candidates = new Set(input.actions.filter(action => action.type === 'discard' || action.type === 'riichi').map(action => action.tileId));
    input.ownHand.forEach((tile, index) => {
      if (!candidates.has(tile.id)) return;
      const hint = makeHint(input.ownHand.filter((_, i) => i !== index).map(item => item.tile), tile.tile);
      hint.riichiEligible = input.actions.some(action => action.type === 'riichi' && action.tileId === tile.id);
      discards[tile.id] = hint;
    });
    // On a draw-size hand, current discard-furiten is not meaningful until a discard is selected.
    const furiten = current?.furiten ?? furitenView([], [], missed);
    previousKey = key;
    previousValue = { current, discards, furiten, ronAvailable: input.actions.some(action => action.type === 'ron') };
    return previousValue;
  };
}
