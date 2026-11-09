import type { ModeId } from './types';

export interface ModeDefinition {
  id: ModeId;
  name: string;
  shortName: string;
  family: '日本' | '竞技' | '四川' | '华南' | '地方';
  players: 3 | 4;
  handSize: 13 | 16;
  description: string;
  features: string[];
  status: 'playable' | 'development';
  ruleVersion: string;
}

export const MODES: ModeDefinition[] = [
  { id:'riichi',name:'四人立直',shortName:'立直',family:'日本',players:4,handSize:13,description:'东南半庄 · 役与振听 · 赤宝牌',features:['立直','宝牌','振听'],status:'playable',ruleVersion:'标准四人立直' },
  { id:'sanma',name:'三人立直',shortName:'三麻',family:'日本',players:3,handSize:13,description:'去二至八万 · 拔北 · 不允许吃牌',features:['三人','拔北','立直'],status:'playable',ruleVersion:'雀境三麻固定局数桌 v1' },
  { id:'mcr',name:'国标麻将',shortName:'国标',family:'竞技',players:4,handSize:13,description:'八番起和 · 八十一番种 · 补花',features:['81番种','8番起和','补花'],status:'playable',ruleVersion:'国标81番短局桌 v1' },
  { id:'sichuan-blood',name:'四川血战',shortName:'血战',family:'四川',players:4,handSize:13,description:'定缺 · 血战到底 · 查叫与查花猪',features:['定缺','换三张可选','血战到底'],status:'playable',ruleVersion:'雀境四川血战' },
  { id:'sichuan-river',name:'四川血流',shortName:'血流',family:'四川',players:4,handSize:13,description:'定缺 · 和牌后继续 · 一局多次和牌',features:['定缺','换三张可选','血流成河'],status:'playable',ruleVersion:'雀境四川血流' },
  { id:'hongkong',name:'香港麻将',shortName:'港式',family:'华南',players:4,handSize:13,description:'清章三番起和 · 番数结算 · 花牌',features:['三番起和','花牌','清章'],status:'playable',ruleVersion:'雀境港式清章 v1' },
  { id:'guangdong',name:'广东推倒胡',shortName:'广东',family:'华南',players:4,handSize:13,description:'平胡可和 · 吃碰杠 · 无癞子',features:['平胡可和','吃碰杠','快速对局'],status:'playable',ruleVersion:'雀境广东无鬼推倒胡 v1' },
  { id:'taiwan',name:'台湾十六张',shortName:'台麻',family:'华南',players:4,handSize:16,description:'五组面子一对将 · 花牌 · 台数计分',features:['十六张','补花','台数'],status:'playable',ruleVersion:'雀境台麻十六张 v1' },
  { id:'hangzhou',name:'杭州麻将',shortName:'杭州',family:'地方',players:4,handSize:13,description:'百搭 · 自摸 · 连庄',features:['百搭','自摸','连庄'],status:'playable',ruleVersion:'雀境杭州固定桌规 v1' },
  { id:'wuhan',name:'武汉麻将',shortName:'武汉',family:'地方',players:4,handSize:13,description:'赖子 · 开口 · 二五八将',features:['赖子','开口','二五八将'],status:'playable',ruleVersion:'雀境武汉固定桌规 v1' },
  { id:'changsha',name:'长沙麻将',shortName:'长沙',family:'地方',players:4,handSize:13,description:'二五八将 · 大小胡 · 扎鸟',features:['二五八将','大小胡','扎鸟'],status:'playable',ruleVersion:'雀境长沙固定桌规 v1' },
  { id:'northeast',name:'东北麻将',shortName:'东北',family:'地方',players:4,handSize:13,description:'哈尔滨基础开门桌 · 三门齐 · 有幺九',features:['三门齐','幺九','开门'],status:'playable',ruleVersion:'雀境哈尔滨基础开门桌（无宝）v1' },
];
export const MODE_CATALOG = MODES;
export const getMode = (id: ModeId = 'riichi'): ModeDefinition => MODES.find(mode => mode.id === id) || MODES[0];
export const getPlayableModes = (): ModeDefinition[] => MODES.filter(mode => mode.status === 'playable');
