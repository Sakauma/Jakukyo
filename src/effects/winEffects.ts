import type { GameSnapshot, ModeId, WinnerView } from '../game/types';

export interface WinEffect {
  id: string;
  tier: 1 | 2 | 3;
  title: string;
  subtitle: string;
  playerName: string;
  preview?: boolean;
}

function rankWin(mode: ModeId, winner: WinnerView): Pick<WinEffect, 'tier' | 'title'> | null {
  const fan = winner.han;
  if (mode === 'riichi' || mode === 'sanma') {
    if (winner.yakuman > 0) return { tier: 3, title: winner.yakuman > 1 ? `${winner.yakuman} 倍役满` : '役 满' };
    if (fan >= 13) return { tier: 3, title: '累计役满' };
    if (fan >= 11) return { tier: 2, title: '三 倍 满' };
    if (fan >= 8) return { tier: 2, title: '倍 满' };
    if (fan >= 6) return { tier: 1, title: '跳 满' };
    if (fan >= 5 || (fan === 4 && winner.fu >= 40) || (fan === 3 && winner.fu >= 70)) return { tier: 1, title: '满 贯' };
    return null;
  }
  if (mode === 'mcr') return fan >= 64 ? { tier: 3, title: '高番和牌' } : fan >= 32 ? { tier: 2, title: '大牌和了' } : null;
  if (mode.startsWith('sichuan')) return fan >= 4 ? { tier: 2, title: '高番和牌' } : fan >= 3 ? { tier: 1, title: '好牌成和' } : null;
  if (mode === 'hongkong') return fan >= 10 ? { tier: 3, title: '高番和牌' } : fan >= 7 ? { tier: 2, title: '大牌和了' } : null;
  if (mode === 'taiwan') return fan >= 16 ? { tier: 3, title: '高台和牌' } : fan >= 8 ? { tier: 2, title: '大牌和了' } : null;
  const names = winner.yaku.map(yaku => yaku.name).join(' ');
  if (/大三元|大四喜|字一色|十三幺|国士|十八罗汉/.test(names)) return { tier: 3, title: '名牌成和' };
  if (/清一色|龙七对|豪华七对|清七对/.test(names) || fan >= 8) return { tier: 2, title: '大牌和了' };
  if (/七对|碰碰胡|碰碰和|杠上开花|爆头|财飘/.test(names) || fan >= 4) return { tier: 1, title: '好牌成和' };
  return null;
}

/** Triggered by actual public settlement data, never by an unconfirmed hand shape. */
export function getWinEffect(snapshot: GameSnapshot): WinEffect | null {
  if (snapshot.status !== 'roundEnd' || snapshot.result?.kind !== 'win') return null;
  const mode = snapshot.mode ?? 'riichi';
  const ranked = snapshot.result.winners.map(winner => ({ winner, rank: rankWin(mode, winner) }))
    .filter((entry): entry is { winner: WinnerView; rank: Pick<WinEffect, 'tier' | 'title'> } => entry.rank !== null)
    .sort((left, right) => right.rank.tier - left.rank.tier || right.winner.han - left.winner.han);
  const best = ranked[0];
  if (!best) return null;
  const player = snapshot.players.find(item => item.id === best.winner.playerId);
  return {
    id: `${snapshot.seed}:${mode}:${snapshot.round.wind}:${snapshot.round.hand}:${snapshot.round.honba}:${snapshot.result.scores.join(',')}:${best.winner.playerId}:${best.winner.han}`,
    ...best.rank,
    playerName: player?.name ?? '和牌者',
    subtitle: `${snapshot.modeName ?? '麻将'} · ${best.winner.yakuman ? `${best.winner.yakuman} 倍役满` : `${best.winner.han} ${mode === 'taiwan' ? '台' : '番'}${best.winner.fu ? ` ${best.winner.fu} 符` : ''}`}`,
  };
}
