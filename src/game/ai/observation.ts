import type { BotObservation } from './types';

interface PublicBoardSource {
  player_id: number[];
  defen: number[];
  zhuangfeng: number;
  jushu: number;
  changbang: number;
  lizhibang: number;
  shan: { baopai: string[]; paishu: number };
  shoupai: { lizhi: boolean; _fulou: string[] }[];
  he: { _pai: string[] }[];
}

/** No opponent hand contents, engine references, actual wall, or deal seed are copied into AI input. */
export function createBotObservation(ownId: number, seat: number, ownHand: string, board: PublicBoardSource, matchLength: 'single' | 'east' | 'hanchan'): BotObservation {
  const players = board.player_id.map((id, playerSeat) => ({
    id, seat: playerSeat, points: board.defen[id], dealer: playerSeat === 0,
    riichi: Boolean(board.shoupai[playerSeat].lizhi),
    melds: [...board.shoupai[playerSeat]._fulou],
    discards: board.he[playerSeat]._pai.map(tile => ({ tile: tile.slice(0, 2), called: /[+=-]$/.test(tile), riichi: tile.includes('*'), tsumogiri: tile.includes('_') })),
  }));
  const observation: BotObservation = {
    ownId, seat, ownHand, players, playerCount: board.player_id.length,
    roundWind: board.zhuangfeng, roundHand: board.jushu + 1,
    finalRound: matchLength === 'single' || board.zhuangfeng > (matchLength === 'east' ? 0 : 1)
      || board.zhuangfeng === (matchLength === 'east' ? 0 : 1) && board.jushu >= 3,
    doraIndicators: [...board.shan.baopai], tilesLeft: board.shan.paishu,
    honba: board.changbang, riichiSticks: board.lizhibang,
    allowOpenTanyao: true, discardFuriten: true, tileLimits: Array<number>(34).fill(4),
    pointScale: 1, expectedDealInValue: 4000, dealerValueMultiplier: 1.5,
    seed: '',
  };
  // Sampling is deterministic from observable state, not from the hidden wall's shuffle seed.
  observation.seed = `${ownId}|${ownHand}|${board.zhuangfeng}:${board.jushu}|${board.shan.paishu}|${players.map(player => player.discards.map(discard => discard.tile).join('')).join('|')}`;
  return observation;
}
