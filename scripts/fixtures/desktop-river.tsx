// Isolated component fixture for rare rule states; never bundled into the game or its previews.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { GameSnapshot, DiscardTile } from '../../src/game/types';
import { tileLabel } from '../../src/game/variants/tiles';
import { DesktopRiverWing } from '../../src/table/DesktopRivers';
import { TableRiverField } from '../../src/table/TableRiverField';
import { RiverOverview } from '../../src/table/RiverOverview';
import { getTheme } from '../../src/table/themes';
import { prepareTileArt } from '../../src/table/tileArt';
import { tileName } from '../../src/table/tileTextures';
import '../../src/styles.css';
import '../../src/pixelMode.css';

const flowerLabels = Array.from({length:8}, (_,i) => {
  const f = 'f' + (i+1); return [tileName(f), tileLabel(f)];
});
export async function mount() {
  await prepareTileArt();
  createRoot(document.getElementById('test')!).render(<Fixture />);
}
function Fixture() {
  const [count, setCount] = useState(29), [called, setCalled] = useState(false), [three, setThree] = useState(false);
  const [open, setOpen] = useState<number | null>(null);
  const history: DiscardTile[] = Array.from({length:count}, (_,i) => ({
    tile:['z5','p0','p5','m6','p9','s8'][i%6], called:i===0 || called && i===count-1, riichi:i===0, tsumogiri:i%3===1,
  }));
  const snapshot: GameSnapshot = {
    mode:three?'sanma':'riichi', status:'playing', phase:'discard', seed:'ui-only', turn:0, humanId:0, actions:[], message:'', log:[], result:null,
    autoPlay:false, speed:250, revision:count, shanten:null, waits:[], lastDiscard:{playerId:2,riverIndex:count-1},
    round:{wind:'东',hand:1,honba:0,dealer:0,riichiSticks:1,tilesLeft:4,doraIndicators:[],uraIndicators:[]},
    players:['你','青岚','千鹤','北辰'].slice(0,three?3:4).map((name,id) => ({id,name,wind:['东','南','西','北'][id],points:35000,riichi:id===2,dealer:id===0,isHuman:id===0,
      hand:[],concealedCount:10,discards:id===2?history:[],melds:[]})),
  };
  const props = { snapshot, theme:getTheme('jade',true), selected:'p5', onOpen:() => {} };
  return <><div className="app pixel-mode" style={{height:440,minHeight:0}}>
    <div className="table-workspace has-desk-rivers"><DesktopRiverWing edge="left" {...props}/><div/><DesktopRiverWing edge="right" {...props}/></div>
    <button id="append" onClick={() => setCount(n=>n+1)}>追加弃牌</button><button id="call" onClick={() => setCalled(true)}>鸣走末张</button>
    <button id="three" onClick={() => setThree(true)}>三人桌</button>
    <output id="flower-labels" hidden>{JSON.stringify(flowerLabels)}</output>
  </div><div className="app pixel-mode" style={{position:'relative',height:502,minHeight:0}}>
    <TableRiverField {...props} onOpen={setOpen} />
    {open !== null && <RiverOverview snapshot={snapshot} theme={props.theme} highlightedTile={props.selected} initialSeat={open} onClose={() => setOpen(null)}/>}
  </div></>;
}
