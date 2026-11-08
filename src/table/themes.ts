export type ThemeId = 'jade' | 'sakura' | 'midnight' | 'contrast';

/** A theme changes the actual lit table and tiles as well as the surrounding UI. */
export interface TableTheme {
  id: ThemeId;
  name: string;
  subtitle: string;
  motif: 'weave' | 'petal' | 'stars' | 'plain';
  background: string;
  felt: string;
  rail: string;
  trim: string;
  tileBack: string;
  tileFace: string;
  ink: string;
  red: string;
  green: string;
  light: string;
  fillLight: string;
  exposure: number;
  ui: { surface: string; panel: string; raised: string; text: string; muted: string; accent: string; border: string };
}

export const TABLE_THEMES: TableTheme[] = [
  {
    id: 'jade', name: '竹影茶室', subtitle: '青玉绒面 · 黄铜包边', motif: 'weave',
    background: '#0e211c', felt: '#245f4e', rail: '#493727', trim: '#a99360',
    tileBack: '#205746', tileFace: '#f7f4e9', ink: '#183039', red: '#a92722', green: '#165735',
    light: '#fff4e2', fillLight: '#c4d8d2', exposure: 1.02,
    ui: { surface: '#10251f', panel: '#172e25', raised: '#263f31', text: '#eee9d6', muted: '#a1b2a5', accent: '#d0ba80', border: '#53654a' },
  },
  {
    id: 'sakura', name: '春樱庭院', subtitle: '藕紫织席 · 樱木桌沿', motif: 'petal',
    background: '#2a2029', felt: '#785369', rail: '#845541', trim: '#cfad8e',
    tileBack: '#944e6a', tileFace: '#fbf5eb', ink: '#382936', red: '#a92043', green: '#285447',
    light: '#fff2e6', fillLight: '#e7dced', exposure: 1.05,
    ui: { surface: '#2b202a', panel: '#412d3b', raised: '#604455', text: '#fff0e8', muted: '#d1b5c5', accent: '#ecc2a7', border: '#927386' },
  },
  {
    id: 'midnight', name: '月下星庭', subtitle: '靛蓝绒面 · 冷银饰边', motif: 'stars',
    background: '#101728', felt: '#273f6e', rail: '#20283b', trim: '#8dabc8',
    tileBack: '#314d88', tileFace: '#f0f3fa', ink: '#142e57', red: '#bb334e', green: '#137466',
    light: '#eef3ff', fillLight: '#b5c4ec', exposure: 1.04,
    ui: { surface: '#101b2c', panel: '#18293f', raised: '#2c4260', text: '#eef3ff', muted: '#a9bed6', accent: '#a8c9ed', border: '#526d8e' },
  },
  {
    id: 'contrast', name: '清晰棋室', subtitle: '高对比牌面 · 均匀照明', motif: 'plain',
    background: '#151a1d', felt: '#394b55', rail: '#161b20', trim: '#d5dbdf',
    tileBack: '#263b48', tileFace: '#ffffff', ink: '#071526', red: '#ad0928', green: '#006944',
    light: '#ffffff', fillLight: '#ffffff', exposure: 1.07,
    ui: { surface: '#10171c', panel: '#1b2832', raised: '#354b5b', text: '#ffffff', muted: '#d6e0e7', accent: '#ffe091', border: '#91a6b4' },
  },
];

export function getTheme(id?: string): TableTheme {
  return TABLE_THEMES.find(theme => theme.id === id) ?? TABLE_THEMES[0];
}

export function tableSeat(id: number, playerCount: number): number {
  // Three-player play leaves the far side empty: both opponents stay easy to read.
  return playerCount === 3 && id === 2 ? 3 : id;
}
