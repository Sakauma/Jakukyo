import type { RiichiFuritenView } from './types';

export function noYakuReason(_closed: boolean): string {
  return '无役，不能荣和（宝牌不算役）';
}

/** Wording is derived only from actual rule state, never from the AI's hand estimate. */
export function furitenReasons(furiten: RiichiFuritenView): string[] {
  return furiten.reasons.map(reason => reason === 'discard'
    ? '舍牌振听，不能荣和'
    : reason === 'riichi-pass'
      ? '立直振听，本局只能自摸'
      : '同巡振听，下次摸牌后解除');
}
