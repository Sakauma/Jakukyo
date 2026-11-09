import { Component, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import MahjongTable from './table/MahjongTable';
import type { DiscardIntent } from './table/MahjongTable';
import { tileName } from './table/tileTextures';
import { getTheme, TABLE_THEMES, tableSeat } from './table/themes';
import { createHandOrderController } from './table/handOrder';
import { riverLayout } from './table/riverLayout';
import { RiverOverview } from './table/RiverOverview';
import type { ThemeId } from './table/themes';
import { createGameSession } from './game/runtime';
import { getMode, MODES } from './game/catalog';
import { getProfile } from './game/variants/rules';
import { normalizeSichuanOptions, sichuanRuleSummary } from './game/variants/sichuan';
import { DIFFICULTIES, validDifficulty } from './game/ai/types';
import type { Difficulty } from './game/ai/types';
import type { ConfirmedWinEvent, GameSessionAPI, HandTile, LegalAction, ModeId, QuickControls, SavedGame, SessionOptions, SichuanOptions } from './game/types';
import { getWinEffect } from './effects/winEffects';
import type { WinEffect } from './effects/winEffects';
import { WinCelebration, useReducedMotion } from './effects/WinCelebration';
import { createTableAudio, DEFAULT_AUDIO_PREFERENCES } from './audio';
import { WinFeedback } from './effects/WinFeedback';
import { RoundSettlement } from './settlement/RoundSettlement';
import { RiichiAssistPanel } from './assist-ui/RiichiAssistPanel';
import { RegionalAssistPanel } from './assist-ui/RegionalAssistPanel';
import { ResponseFeedback, useRonFeedback } from './assist-ui/ResponseFeedback';
import { DiscardFeedback } from './assist-ui/DiscardFeedback';
import { getRiverMatches, resolveRiverSelection, riverSelectionScope } from './presentation/riverMatches';
import { displayScoringText } from './presentation/scoringText';
import { DEFAULT_QUICK_CONTROLS, updateQuickControls } from './game/quickControls';
import { beginRecord, observeRecord, flushRecords } from './records/store';
import { ReplayLibrary } from './replay-ui/ReplayLibrary';
import { ExperienceDialog } from './experience-ui/ExperienceDialog';
import { HelpCenter, type HelpLessonId } from './experience-ui/HelpCenter';
import { StatsPanel } from './experience-ui/StatsPanel';

const SAVE_KEY = 'jakukyo.saved.v1';
const PREF_KEY = 'jakukyo.preferences.v2';
const emptySubscribe = () => () => {};
const emptySnapshot = () => null;
const format = (value: number) => value.toLocaleString('en-US');
const japanese = (mode: string) => mode === 'riichi' || mode === 'sanma';
const suitLabel = (suit?: string) => (({ m: '万', p: '筒', s: '条' } as Record<string, string>)[suit ?? ''] ?? suit ?? '');

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    settings: <><path d="M4 7h16M4 17h16" /><circle cx="9" cy="7" r="3" /><circle cx="15" cy="17" r="3" /></>,
    book: <><path d="M12 5c-3-2-7-2-9 0v15c3-2 6-2 9 0 3-2 6-2 9 0V5c-2-2-6-2-9 0Z" /><path d="M12 5v15" /></>,
    view: <><path d="m12 3 10 6-10 6L2 9l10-6Z" /><path d="m2 15 10 6 10-6M2 12l10 6 10-6" /></>,
    sound: <><path d="M11 4 5 9H2v6h3l6 5V4ZM15 8c2 2 2 6 0 8M18 5c4 4 4 10 0 14" /></>,
    mute: <><path d="M11 4 5 9H2v6h3l6 5V4ZM16 9l6 6M22 9l-6 6" /></>,
    log: <><path d="M5 3h14v18H5zM8 7h8M8 11h8M8 15h5" /></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    download: <><path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" /></>,
    restart: <><path d="M3 10a9 9 0 1 1 1 7M3 3v7h7" /></>,
    home: <><path d="m3 11 9-8 9 8M5 10v11h14V10M10 21v-7h4v7" /></>,
    palette: <><circle cx="12" cy="12" r="9" /><path d="M12 3c0 7 9 6 9 9M3 12c7 0 6 9 9 9" /></>,
    bot: <><rect x="4" y="7" width="16" height="13" rx="4" /><path d="M12 7V3M9 15h6" /><circle cx="8" cy="11" r=".7" /><circle cx="16" cy="11" r=".7" /></>,
    sort: <><path d="M4 5h10M4 10h7M4 15h4M17 4v15m-3-3 3 3 3-3" /></>,
    river: <><rect x="3" y="4" width="4" height="6" rx="1" /><rect x="10" y="4" width="4" height="6" rx="1" /><rect x="17" y="4" width="4" height="6" rx="1" /><rect x="3" y="14" width="4" height="6" rx="1" /><rect x="10" y="14" width="4" height="6" rx="1" /></>,
    chart: <><path d="M4 3v18h17M8 16v-5M13 16V7M18 16V4" /></>,
    help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 8a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4M12 16h.01" /></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] ?? paths.view}</svg>;
}

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <div className="webgl-fallback"><strong>3D 牌桌暂时无法启动</strong><p>请启用浏览器的硬件加速，再使用新版 Edge 或 Chrome 打开。</p></div> : this.props.children; }
}

interface Preferences { speed?: number; sound?: boolean; bgm?: boolean; musicVolume?: number; autoSort?: boolean; riichiHints?: boolean; quickControls?: Partial<QuickControls>; autoPlayDifficulty?: Difficulty; autoExchangeThree?: boolean; masterVolume?: number; effectsVolume?: number; ambienceVolume?: number; winEffects?: boolean; mode?: ModeId; difficulty?: Difficulty; theme?: ThemeId; matchLength?: SessionOptions['matchLength']; exchangeThree?: boolean; sichuan?: Partial<SichuanOptions> }
function readPrefs(): Preferences { try { return JSON.parse(localStorage.getItem(PREF_KEY) ?? localStorage.getItem('jakukyo.preferences.v1') ?? '{}'); } catch { return {}; } }
function readSave(): SavedGame | null { try { const value = localStorage.getItem(SAVE_KEY); return value ? JSON.parse(value) : null; } catch { return null; } }
function volume(value: number | undefined, fallback: number) { return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback; }

function VolumeSlider({ label, value, onChange, disabled }: { label: string; value: number; onChange: (value: number) => void; disabled: boolean }) {
  return <label className={`volume-slider ${disabled ? 'volume-disabled' : ''}`}><span>{label}</span><input type="range" min="0" max="100" step="1" value={Math.round(value * 100)} aria-label={label} disabled={disabled} onChange={event => onChange(Number(event.target.value) / 100)} /><output>{Math.round(value * 100)}%</output></label>;
}

function ThemePicker({ value, onChange }: { value: ThemeId; onChange: (id: ThemeId) => void }) {
  return <div className="theme-options" role="group" aria-label="牌桌主题">{TABLE_THEMES.map(theme =>
    <button key={theme.id} type="button" className={`theme-option ${value === theme.id ? 'selected' : ''}`} aria-pressed={value === theme.id} onClick={() => onChange(theme.id)} title={theme.subtitle}>
      <span className="theme-sample" style={{ '--swatch-felt': theme.felt, '--swatch-rail': theme.rail, '--swatch-trim': theme.trim, '--swatch-back': theme.tileBack } as CSSProperties}><i /><i /><i /></span>
      <span>{theme.name}</span>
    </button>)}</div>;
}

function QuickControlButtons({ value, onChange, settings = false }: { value: QuickControls; onChange: (change: Partial<QuickControls>) => void; settings?: boolean }) {
  const items: Array<{ key: keyof QuickControls; label: string; description: string }> = [
    { key: 'autoWin', label: '自动和牌', description: '当前操作允许和牌时，自动确认自摸或荣和' },
    { key: 'autoDiscard', label: '自动摸切', description: '没有待确认的和牌时，自动打出可合法舍弃的摸入牌' },
    { key: 'noCall', label: '不鸣牌', description: '自动跳过吃碰杠响应，保留和牌机会' },
  ];
  return <div className={`quick-controls ${settings ? 'quick-controls-settings' : ''}`} role="group" aria-label={settings ? '快捷操作设置' : '快捷操作'}>{items.map(item => <button key={item.key} type="button" role="switch" aria-checked={value[item.key]} aria-label={`${settings ? '设置' : ''}${item.label}`} title={item.description} className={value[item.key] ? 'is-on' : ''} onClick={() => onChange({ [item.key]: !value[item.key] })}><i />{item.label}</button>)}</div>;
}

function ExchangePolicySelect({ value, onChange, ariaLabel }: { value: boolean; onChange: (value: boolean) => void; ariaLabel: string }) {
  return <select aria-label={ariaLabel} value={value ? 'auto' : 'manual'} onChange={event => onChange(event.target.value === 'auto')}><option value="manual">每局由我确认</option><option value="auto">自动换牌</option></select>;
}

function SichuanRulesPicker({ value, onChange }: { value: SichuanOptions; onChange: (value: SichuanOptions) => void }) {
  return <div className="sichuan-options" role="group" aria-label="四川计分规则">
    <label>封顶<select aria-label="四川封顶番数" value={value.fanCap} onChange={event => onChange(normalizeSichuanOptions({ ...value, fanCap: event.target.value === 'none' ? 'none' : Number(event.target.value), version: 2 }))}>{[3, 4, 5, 6, 8].map(fan => <option key={fan} value={fan}>{fan} 番</option>)}<option value="none">不封顶</option></select></label>
    <label>自摸<select aria-label="四川自摸计分" value={value.selfDraw} onChange={event => onChange(normalizeSichuanOptions({ ...value, selfDraw: event.target.value, version: 2 }))}><option value="base">加底</option><option value="fan">加番</option></select></label>
    <label className="sichuan-extra"><input type="checkbox" checked={value.menqingZhongzhang} onChange={event => onChange({ ...value, version: 2, menqingZhongzhang: event.target.checked })} />门清/中张</label>
  </div>;
}

function LegalActionButton({ action, onAction }: { action: LegalAction; onAction: (action: LegalAction) => void }) {
  return <button className={`action-button ${['ron', 'tsumo'].includes(action.type) ? 'win-button' : ''} ${action.type === 'pass' ? 'pass-button' : ''}`} aria-label={`${action.label}${action.tiles?.length ? ` ${action.tiles.map(tileName).join(' ')}` : ''}`} title={action.description} onClick={() => onAction(action)}><span>{action.label}</span>{!!action.tiles?.length && <small className="action-tiles">{action.tiles.map((tile, i) => <i key={i}>{tileName(tile)}</i>)}</small>}</button>;
}

export default function App() {
  const [session, setSession] = useState<GameSessionAPI | null>(null);
  const snapshot = useSyncExternalStore(session?.subscribe ?? emptySubscribe, session?.getSnapshot ?? emptySnapshot, emptySnapshot);
  const [saved, setSaved] = useState<SavedGame | null>(readSave);
  const [modeId, setModeId] = useState<ModeId>(() => getMode(readPrefs().mode).id);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => validDifficulty(readPrefs().difficulty) ? readPrefs().difficulty! : 'standard');
  const [autoPlayDifficulty, setAutoPlayDifficulty] = useState<Difficulty>(() => validDifficulty(readPrefs().autoPlayDifficulty) ? readPrefs().autoPlayDifficulty! : 'expert');
  const [autoExchangeThree, setAutoExchangeThree] = useState(() => readPrefs().autoExchangeThree === true);
  const [themeId, setThemeId] = useState<ThemeId>(() => getTheme(readPrefs().theme).id);
  const [matchLength, setMatchLength] = useState<NonNullable<SessionOptions['matchLength']>>(() => readPrefs().matchLength ?? 'hanchan');
  const [exchangeThree, setExchangeThree] = useState(() => readPrefs().exchangeThree ?? false);
  const [sichuanOptions, setSichuanOptions] = useState<SichuanOptions>(() => ({ ...normalizeSichuanOptions(readPrefs().sichuan, 2), version: 2 }));
  const [family, setFamily] = useState('全部');
  const [handSelection, setHandSelection] = useState<{ id: string; scope: string } | null>(null);
  const [discardIntent, setDiscardIntent] = useState<DiscardIntent | null>(null);
  const discardSequence = useRef(0);
  const highlightedTile = resolveRiverSelection(snapshot, handSelection?.id ?? null, handSelection?.scope ?? null);
  const selectedId = highlightedTile ? handSelection?.id ?? null : null;
  const riverMatches = getRiverMatches(snapshot?.players ?? [], highlightedTile);
  const [riichiMode, setRiichiMode] = useState(false);
  const [panel, setPanel] = useState<'rules' | 'settings' | 'log' | 'themes' | null>(null);
  const [experiencePanel, setExperiencePanel] = useState<'library' | 'stats' | 'help' | null>(null);
  const [helpLesson, setHelpLesson] = useState<HelpLessonId>('controls');
  const [view, setView] = useState<'perspective' | 'overhead'>('perspective');
  const [speed, setSpeed] = useState(() => readPrefs().speed ?? 650);
  const [sound, setSound] = useState(() => readPrefs().sound ?? true);
  const [bgm, setBgm] = useState(() => readPrefs().bgm ?? DEFAULT_AUDIO_PREFERENCES.bgm);
  const [musicVolume, setMusicVolume] = useState(() => volume(readPrefs().musicVolume, DEFAULT_AUDIO_PREFERENCES.music));
  const [autoSort, setAutoSort] = useState(() => readPrefs().autoSort ?? true);
  const [riichiHints, setRiichiHints] = useState(() => readPrefs().riichiHints ?? true);
  const [quickPreferences, setQuickPreferences] = useState<QuickControls>(() => updateQuickControls({ ...DEFAULT_QUICK_CONTROLS }, readPrefs().quickControls));
  const [handOrder] = useState(createHandOrderController);
  const [, refreshHandOrder] = useState(0);
  const [showRivers, setShowRivers] = useState(false);
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [masterVolume, setMasterVolume] = useState(() => volume(readPrefs().masterVolume, DEFAULT_AUDIO_PREFERENCES.master));
  const [effectsVolume, setEffectsVolume] = useState(() => volume(readPrefs().effectsVolume, DEFAULT_AUDIO_PREFERENCES.effects));
  const [ambienceVolume, setAmbienceVolume] = useState(() => volume(readPrefs().ambienceVolume, DEFAULT_AUDIO_PREFERENCES.ambience));
  const [winEffects, setWinEffects] = useState(() => readPrefs().winEffects ?? true);
  const [celebration, setCelebration] = useState<WinEffect | null>(null);
  const [feedbackEvent, setFeedbackEvent] = useState<ConfirmedWinEvent | null>(null);
  const reducedMotion = useReducedMotion();
  const seenWins = useRef(new Set<string>());
  const [seed, setSeed] = useState('');
  const [notice, setNotice] = useState('');
  const [unsavedNext, setUnsavedNext] = useState<LegalAction | null>(null);
  const [webglFailed, setWebglFailed] = useState(false);
  const sessionRef = useRef<GameSessionAPI | null>(null);
  const recordIdRef = useRef<string | null>(null);
  const recordTransitionRef = useRef(false);
  const audioRef = useRef<ReturnType<typeof createTableAudio> | null>(null);
  const logEnd = useRef<HTMLDivElement>(null);
  const theme = getTheme(themeId);
  const selectedMode = getMode(modeId);
  const activeMode = getMode(snapshot?.mode ?? modeId);
  const activeDifficulty = DIFFICULTIES.find(item => item.id === (snapshot?.difficulty ?? difficulty)) ?? DIFFICULTIES[1];
  const activeAutoPlayDifficulty = DIFFICULTIES.find(item => item.id === (snapshot?.autoPlayDifficulty ?? autoPlayDifficulty)) ?? DIFFICULTIES[3];
  const activeAutoExchangeThree = snapshot?.autoExchangeThree ?? autoExchangeThree;
  const exchangeThreeEnabled = activeMode.id.startsWith('sichuan') && exchangeThree;
  const isSichuan = activeMode.id.startsWith('sichuan');
  const isJapanese = japanese(activeMode.id);
  const activeSichuanOptions = snapshot ? normalizeSichuanOptions(snapshot.sichuanOptions, 1) : sichuanOptions;
  const activeRuleVersion = isSichuan ? activeSichuanOptions.version === 1 ? '旧版川麻计番 v1' : '川麻扩展计番 v2' : activeMode.ruleVersion;
  const ruleNotes = snapshot?.ruleSummary ?? (isSichuan ? [...getProfile(activeMode.id).summary, ...sichuanRuleSummary(activeSichuanOptions)] : [activeMode.description, ...(isJapanese ? ['一番起和；宝牌本身不构成役。', '立直需要门清听牌并支付 1,000 点；振听时不能荣和。'] : [])]);
  const unit = snapshot?.scoreUnit ?? '点';
  const scoringPlayers = snapshot?.players.map(player => player.name) ?? [];
  const themeVars = { '--surface': theme.ui.surface, '--panel': theme.ui.panel, '--raised': theme.ui.raised, '--cream': theme.ui.text, '--muted': theme.ui.muted, '--gold': theme.ui.accent, '--border-color': theme.ui.border, '--felt': theme.felt } as CSSProperties;

  useEffect(() => () => { flushRecords(); sessionRef.current?.dispose(); }, []);
  useEffect(() => {
    const media = window.matchMedia('(orientation: landscape) and (max-height: 500px) and (max-width: 1100px)');
    const closeOnExit = () => { if (!media.matches) setMobileToolsOpen(false); };
    media.addEventListener('change', closeOnExit);
    return () => media.removeEventListener('change', closeOnExit);
  }, []);
  useEffect(() => {
    const audio = createTableAudio({ sound, bgm, music: musicVolume, master: masterVolume, effects: effectsVolume, ambience: ambienceVolume, theme: themeId }); audioRef.current = audio;
    return () => { audio.dispose(); if (audioRef.current === audio) audioRef.current = null; };
  }, []);
  useEffect(() => { audioRef.current?.setPreferences({ sound, bgm, music: musicVolume, master: masterVolume, effects: effectsVolume, ambience: ambienceVolume, theme: themeId }); }, [sound, bgm, musicVolume, masterVolume, effectsVolume, ambienceVolume, themeId]);
  useEffect(() => { audioRef.current?.sync(snapshot, { reducedMotion }); }, [snapshot?.revision, session, reducedMotion]);
  useEffect(() => {
    try { localStorage.setItem(PREF_KEY, JSON.stringify({ speed, sound, bgm, musicVolume, autoSort, riichiHints, quickControls: quickPreferences, autoPlayDifficulty, autoExchangeThree, masterVolume, effectsVolume, ambienceVolume, winEffects, mode: modeId, difficulty, theme: themeId, matchLength, exchangeThree, sichuan: sichuanOptions })); } catch { /* A private browser can still play. */ }
  }, [speed, sound, bgm, musicVolume, autoSort, riichiHints, quickPreferences, autoPlayDifficulty, autoExchangeThree, masterVolume, effectsVolume, ambienceVolume, winEffects, modeId, difficulty, themeId, matchLength, exchangeThree, sichuanOptions]);
  useEffect(() => { seenWins.current.clear(); setCelebration(null); setFeedbackEvent(null); }, [session]);
  useEffect(() => {
    if (!discardIntent) return;
    const timeout = setTimeout(() => setDiscardIntent(null), 650);
    return () => clearTimeout(timeout);
  }, [discardIntent]);
  useEffect(() => {
    if (!snapshot?.latestWin || seenWins.current.has(snapshot.latestWin.id)) return;
    seenWins.current.add(snapshot.latestWin.id);
    const effect = getWinEffect(snapshot);
    if (winEffects && effect && !snapshot.latestWin.continuing) { setFeedbackEvent(null); setCelebration(effect); }
    else { setCelebration(null); setFeedbackEvent(snapshot.latestWin); }
  }, [snapshot?.latestWin?.id, winEffects, session]);
  useEffect(() => { session?.setSpeed(speed); }, [speed, session]);
  useEffect(() => {
    if (!session || !snapshot) return;
    const timeout = setTimeout(() => { if (sessionRef.current !== session || session.getSnapshot() !== snapshot) return; try { const data = session.getSavedGame(); localStorage.setItem(SAVE_KEY, JSON.stringify(data)); setSaved(data); } catch { setNotice('本地存档不可用，当前对局仍可继续。'); } }, 100);
    return () => clearTimeout(timeout);
  }, [snapshot?.revision, session]);
  useEffect(() => {
    if (!session || !snapshot || !recordIdRef.current || recordTransitionRef.current || sessionRef.current !== session || session.getSnapshot() !== snapshot) return;
    try { observeRecord(recordIdRef.current, session.getSavedGame(), snapshot); }
    catch { setNotice('本地牌谱暂时无法保存，当前对局仍可继续。'); }
  }, [snapshot?.revision, session]);
  useEffect(() => {
    if (!snapshot) return;
    if (handSelection && !highlightedTile) setHandSelection(null);
    if (!snapshot.actions.some(action => action.type === 'riichi')) setRiichiMode(false);
  }, [snapshot?.revision, handSelection, highlightedTile]);
  useEffect(() => { if (panel === 'log') logEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [snapshot?.log.length, panel]);
  useEffect(() => { if (!notice) return; const timeout = setTimeout(() => setNotice(''), 4500); return () => clearTimeout(timeout); }, [notice]);

  function clickSound() { audioRef.current?.select(); }
  function setSelectedId(id: string | null) {
    setHandSelection(id && snapshot ? { id, scope: riverSelectionScope(snapshot) } : null);
  }
  function changeQuickControls(change: Partial<QuickControls>) {
    const next = updateQuickControls(quickPreferences, change);
    setQuickPreferences(next);
    sessionRef.current?.setQuickControls(next);
  }
  function changeAutoPlayDifficulty(value: string) {
    if (!validDifficulty(value)) return;
    setAutoPlayDifficulty(value);
    sessionRef.current?.setAutoPlayDifficulty(value);
  }
  function changeAutoExchangeThree(value: boolean) {
    setAutoExchangeThree(value);
    sessionRef.current?.setAutoExchangeThree(value);
  }
  function openExperience(value: 'library' | 'stats' | 'help', helpTarget: HelpLessonId = 'controls') {
    if (value === 'library' && session) returnLobby();
    if (value === 'help') setHelpLesson(helpTarget);
    flushRecords(); setPanel(null); setShowRivers(false); setExperiencePanel(value);
  }

  function startGame(resume = false) {
    try {
      const startingMode = resume && saved ? saved.mode ?? 'riichi' : modeId;
      const startingAutoPlayDifficulty = resume && saved && validDifficulty(saved.autoPlayDifficulty) ? saved.autoPlayDifficulty : autoPlayDifficulty;
      const startingAutoExchangeThree = resume && saved && typeof saved.autoExchangeThree === 'boolean' ? saved.autoExchangeThree : autoExchangeThree;
      const startingExchangeThree = resume && saved && startingMode.startsWith('sichuan') ? saved.variantOptions?.exchangeThree === true : exchangeThree;
      if (getMode(startingMode).status !== 'playable') { setNotice('这套规则仍在制作中，请先选择已开放的玩法。'); return; }
      const startingLength = resume && saved ? saved.matchLength : (japanese(startingMode) || matchLength === 'endless' ? matchLength : 'east');
      const startingVariants = resume && saved ? saved.variantOptions : { exchangeThree: startingExchangeThree, ...(startingMode.startsWith('sichuan') ? { sichuan: { ...sichuanOptions, version: 2 as const } } : {}) };
      const options: SessionOptions = { mode: startingMode, difficulty: resume && saved ? saved.difficulty ?? 'standard' : difficulty, seed: seed.trim() || undefined, speed, matchLength: startingLength, variantOptions: startingVariants, quickControls: quickPreferences, autoPlayDifficulty: startingAutoPlayDifficulty, autoExchangeThree: startingAutoExchangeThree };
      const next = createGameSession(options);
      if (resume && saved && !next.loadSavedGame(saved)) { next.dispose(); setNotice('此存档与当前规则或 AI 版本不兼容，请重新开局。'); return; }
      next.setQuickControls(quickPreferences);
      next.setAutoPlayDifficulty(startingAutoPlayDifficulty); setAutoPlayDifficulty(startingAutoPlayDifficulty);
      next.setAutoExchangeThree(startingAutoExchangeThree); setAutoExchangeThree(startingAutoExchangeThree); setExchangeThree(startingExchangeThree);
      flushRecords(); sessionRef.current?.dispose(); handOrder.reset(); sessionRef.current = next; setSession(next); setModeId(startingMode);
      try { recordIdRef.current = beginRecord(next.getSavedGame(), { resume }); observeRecord(recordIdRef.current, next.getSavedGame(), next.getSnapshot()); }
      catch { recordIdRef.current = null; setNotice('本地牌谱暂时无法保存，当前对局仍可继续。'); }
      setSelectedId(null); setRiichiMode(false); setDiscardIntent(null); setCelebration(null); setFeedbackEvent(null); setShowRivers(false); setMobileToolsOpen(false); setPanel(null); setUnsavedNext(null);
      setExperiencePanel(null);
      const audio = audioRef.current; if (audio) void audio.unlock().then(ok => { if (ok && !resume) audio.play('deal'); });
    } catch (error) { setNotice(error instanceof Error ? error.message : '对局暂时无法启动。'); }
  }

  function returnLobby() {
    if (session && recordIdRef.current) { try { observeRecord(recordIdRef.current, session.getSavedGame(), session.getSnapshot()); } catch { /* The record store reports persistent failures separately. */ } }
    flushRecords(); recordIdRef.current = null;
    if (session) { try { const data = session.getSavedGame(); localStorage.setItem(SAVE_KEY, JSON.stringify(data)); setSaved(data); } catch { /* See save notice. */ } session.dispose(); }
    handOrder.reset(); sessionRef.current = null; setSession(null); setPanel(null); setSelectedId(null); setRiichiMode(false); setDiscardIntent(null); setCelebration(null); setFeedbackEvent(null); setShowRivers(false); setMobileToolsOpen(false); setUnsavedNext(null);
    setExperiencePanel(null);
  }
  function dispatch(action: LegalAction, continueWithoutSaving = false): boolean {
    const active = sessionRef.current;
    if (!active || active !== session) return false;
    const current = active.getSnapshot();
    const legal = current.actions.find(candidate => candidate.id === action.id && candidate.type === action.type && candidate.tileId === action.tileId);
    if (!legal) return false;
    const selectionScope = riverSelectionScope(current);
    const previousSave = legal.type === 'next' ? active.getSavedGame() : null;
    const advancingEndless = previousSave?.matchLength === 'endless';
    if (advancingEndless) {
      let recorded = !!recordIdRef.current;
      try { if (recordIdRef.current) observeRecord(recordIdRef.current, previousSave, current); }
      catch { recorded = false; }
      const recordsSaved = flushRecords();
      let gameSaved = true;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(previousSave)); setSaved(previousSave); }
      catch { gameSaved = false; }
      if ((!recorded || !recordsSaved || !gameSaved) && !continueWithoutSaving) {
        setUnsavedNext(legal);
        return false;
      }
    }
    recordTransitionRef.current = advancingEndless;
    try {
      if (!active.dispatch(legal.id)) return false;
      if (advancingEndless) {
        const nextSave = active.getSavedGame();
        try { recordIdRef.current = beginRecord(nextSave, { resume: true }); observeRecord(recordIdRef.current, nextSave, active.getSnapshot()); }
        catch { recordIdRef.current = null; setNotice('本地牌谱暂时无法保存，当前对局仍可继续。'); }
        try { localStorage.setItem(SAVE_KEY, JSON.stringify(nextSave)); setSaved(nextSave); }
        catch { setNotice('本地存档不可用，当前对局仍可继续。'); }
        setUnsavedNext(null);
      }
    } finally { recordTransitionRef.current = false; }
    if ((legal.type === 'discard' || legal.type === 'riichi') && legal.tileId) {
      handOrder.forget(legal.tileId);
      setDiscardIntent({ sequence: ++discardSequence.current, tileId: legal.tileId, selectionScope });
    }
    if (legal.type === 'exchange') clickSound();
    else { setSelectedId(null); setRiichiMode(false); }
    return true;
  }
  function sortHand() { handOrder.sortOnce(); refreshHandOrder(value => value + 1); clickSound(); }
  function exportReplay() {
    if (!session) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(session.exportReplay(), null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a'); anchor.href = url; anchor.download = `雀境-${activeMode.shortName}-${snapshot?.seed ?? '牌谱'}.json`; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); setNotice('牌谱已导出。');
  }

  const human = snapshot?.players.find(player => player.isHuman);
  const handScope = snapshot ? `${snapshot.mode}:${snapshot.seed}:${snapshot.round.wind}:${snapshot.round.hand}:${snapshot.round.honba}:${snapshot.round.dealer}:${snapshot.round.sequence ?? ''}` : 'lobby';
  const displayHand = snapshot ? handOrder.reconcile(human?.hand ?? [], handScope, autoSort) : undefined;
  const exchanging = snapshot?.phase === 'exchange';
  const selectedTile = displayHand?.find(tile => tile.id === selectedId);
  const targetActionType = exchanging ? 'exchange' : riichiMode ? 'riichi' : 'discard';
  const actionTiles = (snapshot?.actions ?? []).filter(action => action.type === targetActionType);
  const selectable = displayHand?.filter(tile => actionTiles.some(action => action.tileId === tile.id || (!action.tileId && action.tile === tile.tile))) ?? [];
  const selectedAction = actionTiles.find(action => action.tileId === selectedId || (!action.tileId && action.tile === selectedTile?.tile));
  const specialActions = snapshot?.actions.filter(action => !['discard', 'riichi', 'next', 'exchange', 'ron', 'tsumo'].includes(action.type)) ?? [];
  const winActions = snapshot?.actions.filter(action => action.type === 'ron' || action.type === 'tsumo') ?? [];
  const ronNotice = useRonFeedback(snapshot, session);
  const hasResponseFeedback = winActions.length > 0 || !!ronNotice;
  const canRiichi = !!snapshot?.actions.some(action => action.type === 'riichi');
  const ownTurn = !!snapshot?.actions.some(action => action.type === 'discard');
  const discardPrompt = human?.riichi ? '已立直 · 只能摸切' : human?.voidSuit && human.hand.some(tile => tile.tile[0] === human.voidSuit) ? '先打缺门' : '请出牌';
  const inRound = snapshot?.status === 'playing';
  const discardAction = ownTurn && inRound && !exchanging ? riichiMode ? 'riichi' : 'discard' : null;
  const nextAction = snapshot?.actions.find(action => action.type === 'next');
  const pendingWinFeedback = !!snapshot?.latestWin && !seenWins.current.has(snapshot.latestWin.id);

  function selectTile(tile: HandTile) {
    if (!selectable.some(item => item.id === tile.id)) return;
    if (exchanging) { const action = actionTiles.find(item => item.tileId === tile.id); if (action) dispatch(action); return; }
    if (selectedId === tile.id && selectedAction) dispatch(selectedAction);
    else { setSelectedId(tile.id); clickSound(); }
  }
  function discardTile(tileId: string, selectionScope: string, action: 'discard' | 'riichi'): boolean {
    const current = sessionRef.current?.getSnapshot();
    if (!current || !discardAction || action !== discardAction || current.status !== 'playing'
      || riverSelectionScope(current) !== selectionScope
      || !current.players.find(player => player.isHuman)?.hand.some(tile => tile.id === tileId)) return false;
    const legal = current.actions.find(candidate => candidate.type === action && candidate.tileId === tileId);
    return !!legal && dispatch(legal);
  }
  useEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      if (showRivers) { if (event.key === 'Escape') setShowRivers(false); return; }
      if (mobileToolsOpen) { if (event.key === 'Escape') setMobileToolsOpen(false); return; }
      if (panel || experiencePanel || unsavedNext || event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement) return;
      if (event.key === 'Escape') { setSelectedId(null); setRiichiMode(false); return; }
      if (!ownTurn && !exchanging) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        event.preventDefault(); const index = selectable.findIndex(tile => tile.id === selectedId), direction = event.key === 'ArrowRight' ? 1 : -1;
        setSelectedId(selectable[index < 0 ? direction > 0 ? 0 : selectable.length - 1 : (index + direction + selectable.length) % selectable.length]?.id ?? null);
        clickSound();
      }
      if (event.key === 'Enter' && selectedAction && !(event.target instanceof HTMLButtonElement)) { event.preventDefault(); dispatch(selectedAction); }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  }, [snapshot?.revision, selectedId, riichiMode, panel, experiencePanel, unsavedNext, showRivers, mobileToolsOpen, autoSort, displayHand]);

  return <div className={`app theme-${themeId} ${session ? 'is-playing' : 'is-lobby'}`} style={themeVars} onPointerDownCapture={() => { void audioRef.current?.unlock(); }} onKeyDownCapture={() => { void audioRef.current?.unlock(); }}>
    <header className="topbar">
      <button className="brand" onClick={returnLobby} aria-label="雀境 返回大厅"><span className="brand-seal">雀</span><div><span className="brand-name">雀 境</span></div></button>
      <div className="game-heading"><span className="small-dot" /><span>{session ? activeMode.name : '自在一桌，各有章法'}</span>{session && <><span className="heading-divider" /><span className="muted">{activeDifficulty.label} AI</span></>}</div>
      <button type="button" className="icon-button mobile-tools-toggle" aria-label="牌桌工具" aria-expanded={mobileToolsOpen} aria-controls="table-tools" onClick={() => setMobileToolsOpen(!mobileToolsOpen)}><Icon name="menu" /></button>
      <nav className="header-actions" aria-label="游戏工具"><button className="text-button experience-nav" onClick={() => openExperience('library')} aria-label={session ? "保存并查看牌谱" : "牌谱库"} title={session ? "保存当前对局并查看牌谱" : "本地牌谱与回放"}><Icon name="log" /><span>{session ? "保存看谱" : "牌谱"}</span></button><button className="text-button experience-nav" onClick={() => openExperience('stats')} aria-label="本地战绩" title="本地战绩"><Icon name="chart" /><span>战绩</span></button><button className="text-button experience-nav" onClick={() => openExperience('help')} aria-label="新手帮助" title="新手帮助"><Icon name="help" /><span>帮助</span></button>{session && <button className="icon-button" onClick={returnLobby} aria-label="保存并返回大厅" title="保存并返回大厅"><Icon name="home" /></button>}<button className="text-button" onClick={() => setPanel('rules')}><Icon name="book" /><span>规则</span></button><button className="icon-button" onClick={() => setPanel('themes')} aria-label="选择牌桌主题" title="牌桌主题"><Icon name="palette" /></button><button className="icon-button" onClick={() => setPanel('settings')} aria-label="游戏设置"><Icon name="settings" /></button></nav>
    </header>
    {mobileToolsOpen && <button type="button" className="mobile-tools-backdrop" aria-label="关闭牌桌工具" onClick={() => setMobileToolsOpen(false)} />}

    <main className="game-shell">
      <div className="table-area" aria-label="3D 麻将牌桌">
        <SceneBoundary><MahjongTable snapshot={snapshot} displayHand={displayHand} selectedId={selectedId} highlightedTile={highlightedTile} selectedIds={snapshot?.setupSelection} interactiveIds={selectable.map(tile => tile.id)} onSelect={selectTile} onTileDiscard={discardTile} discardAction={discardAction} discardIntent={discardIntent} view={view} theme={theme} celebration={reducedMotion ? null : celebration} reducedMotion={reducedMotion} previewPlayerCount={selectedMode.players} onFailure={() => setWebglFailed(true)} onRestore={() => setWebglFailed(false)} /></SceneBoundary>
        <div className="table-vignette" />
        <div id="table-tools" className={`table-tools ${mobileToolsOpen ? 'mobile-open' : ''}`} onClick={event => { if (event.target instanceof Element && event.target.closest('button')) setMobileToolsOpen(false); }} onChange={event => { if (event.target instanceof HTMLSelectElement) setMobileToolsOpen(false); }}>
          {snapshot && <>
            {exchangeThreeEnabled && <label className="exchange-policy-quick"><span>换牌</span><ExchangePolicySelect ariaLabel="换三张托管方式" value={activeAutoExchangeThree} onChange={changeAutoExchangeThree} /></label>}
            <button className={`sort-hand-button assist-quick ${riichiHints ? 'is-on' : ''}`} role="switch" aria-checked={riichiHints} aria-label="听牌辅助" title="显示听张与向听" onClick={() => setRiichiHints(!riichiHints)}><i />听牌辅助</button>
            <button className={`sort-hand-button auto-sort-quick ${autoSort ? 'is-on' : ''}`} role="switch" aria-checked={autoSort} aria-label="自动理牌" onClick={() => setAutoSort(!autoSort)}><i />自动理牌</button>
            <button className="sort-hand-button" onClick={sortHand} disabled={!displayHand?.length} title="按万、筒、条、字牌整理，摸入牌保持最右"><Icon name="sort" size={16} />理牌</button>
            <button className="icon-button" aria-label="牌河全览" title="查看完整牌河" onClick={() => setShowRivers(true)}><Icon name="river" /><span className="table-tool-label">牌河全览</span></button>
          </>}
          <button className={`icon-button ${view === 'overhead' ? 'active' : ''}`} aria-label={view === 'overhead' ? '切换透视视角' : '切换俯视视角'} title="切换视角" onClick={() => setView(view === 'perspective' ? 'overhead' : 'perspective')}><Icon name="view" /><span className="table-tool-label">切换视角</span></button>
          <button className="icon-button" aria-label={sound ? '关闭全部声音' : '打开全部声音'} onClick={() => setSound(!sound)}><Icon name={sound ? 'sound' : 'mute'} /><span className="table-tool-label">{sound ? '关闭声音' : '打开声音'}</span></button>
          {snapshot && <button className="icon-button" aria-label="查看对局记录" onClick={() => setPanel(panel === 'log' ? null : 'log')}><Icon name="log" /><span className="table-tool-label">对局记录</span></button>}
        </div>
        {snapshot && <>
          <div className="round-chip"><span>{snapshot.round.wind}{snapshot.round.hand}局</span>{isJapanese && <><i /><span>{snapshot.round.honba} 本场</span></>}<i /><span className="muted">余牌 <b>{snapshot.round.tilesLeft}</b></span></div>
          <div className="dora-chip">{snapshot.round.doraIndicators.length > 0 && <><span className="eyebrow">宝牌指示牌</span><div>{snapshot.round.doraIndicators.map((tile, i) => <span className={`mini-tile suit-${tile[0]}`} key={i} title={tileName(tile)}>{tileName(tile)}</span>)}</div></>}{snapshot.round.wildcard && <div className="wildcard-chip"><span>百搭</span><b className="mini-tile">{tileName(snapshot.round.wildcard)}</b></div>}</div>
          {snapshot.players.filter(player => !player.isHuman).map(player => <div key={player.id} className={`seat seat-${tableSeat(player.id, snapshot.players.length)} ${snapshot.turn === player.id && inRound ? 'seat-active' : ''} ${player.hasWon ? 'seat-won' : ''}`}>
            <div className="seat-avatar">{player.wind}</div><div className="seat-info"><div className="seat-name">{player.name}<span>{activeDifficulty.label}</span></div><div className="seat-points">{format(player.points)}<small>{unit}</small></div><button className={`river-page-note ${riverLayout(player.discards).pages > 1 ? 'is-paged' : ''}`} onClick={() => setShowRivers(true)} title="查看完整牌河">牌河 {riverLayout(player.discards).count} 张{riverLayout(player.discards).pages > 1 ? ` · 第${riverLayout(player.discards).page}页` : ''}</button><div className="seat-bonuses">{player.voidSuit && <span>缺{ suitLabel(player.voidSuit) }</span>}{!!player.kita && <span>拔北 ×{player.kita}</span>}{!!player.flowers?.length && <span>花 ×{player.flowers.length}</span>}{player.hasWon && <span>已和{player.winCount && player.winCount > 1 ? ` ×${player.winCount}` : ''}</span>}</div></div>{player.riichi ? <span className="riichi-badge">立直</span> : snapshot.turn === player.id && inRound ? <span className="thinking-dots"><i /><i /><i /></span> : null}
          </div>)}
          <div className={`table-caption ${highlightedTile ? 'river-selection-count' : ''}`} role={highlightedTile ? 'status' : undefined}>{highlightedTile ? <><strong>{tileName(selectedTile?.tile ?? highlightedTile)}</strong><span>牌河 {riverMatches.inRiverCount} · 副露 {riverMatches.inMeldCount}</span></> : <>{theme.name} · {activeMode.name}</>}</div>
        </>}
        {!snapshot && <div className="lobby-overlay"><div className="lobby-card lobby-config">
          <h1>好牌，<em>慢慢打。</em></h1>
          <div className="config-label"><span>选择玩法</span><small>{MODES.filter(mode => mode.status === 'playable').length} 种已开放</small></div>
          <div className="family-tabs" role="group" aria-label="玩法分类">{['全部', '日本', '竞技', '四川', '华南', '地方'].map(item => <button key={item} aria-pressed={family === item} className={family === item ? 'active' : ''} onClick={() => setFamily(item)}>{item}</button>)}</div>
          <div className="mode-grid" role="group" aria-label="麻将玩法">{MODES.filter(mode => family === '全部' || mode.family === family).map(mode => <button key={mode.id} disabled={mode.status !== 'playable'} className={`mode-card ${modeId === mode.id ? 'selected' : ''}`} aria-pressed={modeId === mode.id} onClick={() => setModeId(mode.id)} title={`${mode.description} · ${mode.ruleVersion}`}><span className="mode-mark">{mode.shortName.slice(0, 1)}</span><span><strong>{mode.name}</strong><small>{mode.status === 'playable' ? `${mode.players} 人 · ${mode.handSize} 张` : '制作中'}</small></span>{modeId === mode.id && <i />}</button>)}</div>
          <p className="mode-description">{selectedMode.description}</p>
          <div className="config-label"><span>电脑难度</span></div>
          <div className="difficulty-options" role="group" aria-label="电脑难度">{DIFFICULTIES.map((item, index) => <button key={item.id} aria-pressed={difficulty === item.id} className={difficulty === item.id ? 'selected' : ''} onClick={() => setDifficulty(item.id)}><span>{item.label}</span></button>)}</div>
          
          <div className="lobby-options"><label>对局长度<select aria-label="对局长度" value={japanese(modeId) ? matchLength : matchLength === 'endless' ? 'endless' : 'east'} onChange={event => setMatchLength(event.target.value as NonNullable<SessionOptions['matchLength']>)}>{japanese(modeId) ? <><option value="single">单局练习</option><option value="east">东风战</option><option value="hanchan">东南半庄</option></> : <option value="east">标准对局</option>}<option value="endless">无限模式</option></select></label>{modeId.startsWith('sichuan') && <label className="exchange-toggle"><input type="checkbox" checked={exchangeThree} onChange={event => setExchangeThree(event.target.checked)} />开启换三张</label>}<button className="text-button" onClick={() => setPanel('themes')}><span className="theme-dot" style={{ background: theme.felt }} />{theme.name}<Icon name="palette" size={15} /></button></div>
          {modeId.startsWith('sichuan') && <SichuanRulesPicker value={sichuanOptions} onChange={setSichuanOptions} />}
          {exchangeThreeEnabled && <label className="exchange-policy-lobby"><span>托管换牌</span><ExchangePolicySelect ariaLabel="开局换三张托管方式" value={activeAutoExchangeThree} onChange={changeAutoExchangeThree} /></label>}
          <div className="lobby-actions"><button className="primary-button start-button" onClick={() => startGame()} disabled={webglFailed || selectedMode.status !== 'playable'}>开始 {selectedMode.name}<Icon name="arrow" size={20} /></button>
          {saved && <button className="resume-button" onClick={() => startGame(true)}>继续上次对局 <span>{getMode(saved.mode ?? 'riichi').name} · 自动存档</span></button>}</div>
        </div><div className="lobby-stamp"><span>{theme.name.slice(0, 1)}</span><span>{theme.name.slice(1, 2)}</span></div></div>}
        {webglFailed && <div className="webgl-notice">3D 图形连接已中断，请刷新页面恢复存档。</div>}
        <DiscardFeedback snapshot={snapshot} sessionKey={session} theme={theme} reducedMotion={reducedMotion} />
        {snapshot && <RiichiAssistPanel snapshot={snapshot} selectedTile={selectedTile} riichiMode={riichiMode} theme={theme} showDetails={riichiHints} />}
        {snapshot && <RegionalAssistPanel snapshot={snapshot} session={session} selectedTile={selectedTile} notice={ronNotice} theme={theme} showDetails={riichiHints} />}
      </div>

      {snapshot ? <section className={`play-dock ${hasResponseFeedback ? 'has-response-feedback' : ''}`} aria-label="我的手牌与操作">
        <div className="my-seat"><span className="my-avatar">{human?.wind ?? '东'}</span><div><div className="my-name">你 <span>{human?.dealer ? '庄家' : '玩家'}</span>{human?.riichi && <b>立直</b>}{human?.voidSuit && <b>缺{suitLabel(human.voidSuit)}</b>}{human?.hasWon && <b>已和</b>}</div><strong>{format(human?.points ?? 0)}<small>{unit}</small></strong><div className="my-bonuses">{!!human?.flowers?.length && `花 ×${human.flowers.length} `}{!!human?.kita && `拔北 ×${human.kita}`}</div></div></div>
        <div className="turn-prompt" aria-live="polite">{hasResponseFeedback ? <ResponseFeedback winAction={winActions[0]} notice={ronNotice} players={snapshot.players} onHelp={() => isJapanese ? openExperience('help', 'yaku') : setPanel('rules')} helpLabel={isJapanese ? '查看常见役' : '查看本桌规则'} /> : <><div className="prompt-title"><span className={`status-dot ${ownTurn || exchanging ? 'your-turn' : ''}`} />{riichiMode ? '选择立直宣言牌' : exchanging ? snapshot.autoPlay && !activeAutoExchangeThree ? '确认换三张后继续托管' : '换三张' : ownTurn ? discardPrompt : snapshot.phase === 'response' ? '请选择操作' : displayScoringText(snapshot.message, snapshot.mode, scoringPlayers)}</div><>{exchanging && <div className="prompt-detail">同花色 · 已选 {snapshot.setupSelection?.length ?? 0}/3</div>}</></>}{inRound && <QuickControlButtons value={snapshot.quickControls ?? quickPreferences} onChange={changeQuickControls} />}</div>
        <div className="response-actions">{winActions.length > 0 && <div className="win-actions" aria-label="和牌操作">{winActions.map(action => <LegalActionButton key={action.id} action={action} onAction={dispatch} />)}</div>}<div className="game-actions">{specialActions.map(action => <LegalActionButton key={action.id} action={action} onAction={dispatch} />)}
          {canRiichi && <button className={`action-button riichi-action ${riichiMode ? 'is-armed' : ''}`} onClick={() => { setRiichiMode(!riichiMode); setSelectedId(null); }}>{riichiMode ? '取消立直' : '立直'}</button>}
          {ownTurn && <button className="primary-button discard-button" disabled={!selectedAction} onClick={() => selectedAction && dispatch(selectedAction)}>{riichiMode ? '立直 · ' : ''}{selectedTile ? `打出 ${selectedTile.label || tileName(selectedTile.tile)}` : '选一张牌'}<Icon name="arrow" /></button>}
          {!ownTurn && !exchanging && specialActions.length === 0 && winActions.length === 0 && inRound && <span className="waiting-label"><span className="thinking-dots"><i /><i /><i /></span>{snapshot.autoPlay ? '托管中' : '等待出牌'}</span>}
        </div></div>
        <div className="auto-control"><button className={`icon-button ${snapshot.autoPlay ? 'active' : ''}`} title={snapshot.autoPlay ? '关闭托管' : '开启托管'} aria-label={snapshot.autoPlay ? '接管对局' : '开启托管'} aria-pressed={snapshot.autoPlay} onClick={() => session?.setAutoPlay(!snapshot.autoPlay)}><Icon name="bot" /></button><span>{snapshot.autoPlay ? '接管' : '托管'}</span><label className="auto-difficulty-control" title="托管等级"><select aria-label="托管等级" value={activeAutoPlayDifficulty.id} onChange={event => changeAutoPlayDifficulty(event.target.value)}>{DIFFICULTIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label></div>
        <div className="accessible-hand" aria-label="可选手牌">{selectable.map(tile => <button key={tile.id} onFocus={() => setSelectedId(tile.id)} onClick={() => selectTile(tile)} aria-label={`选择${tile.label || tileName(tile.tile)}${tile.drawn ? '，摸入牌' : ''}`}>{tile.label || tileName(tile.tile)}</button>)}</div>
      </section> : null}
    </main>

    {snapshot?.result && !celebration && !feedbackEvent && !pendingWinFeedback && (snapshot.status === 'roundEnd' || snapshot.status === 'matchEnd') && <RoundSettlement snapshot={snapshot} theme={theme} reducedMotion={reducedMotion || !winEffects} onNext={() => nextAction && dispatch(nextAction)} onRestart={() => startGame()} onLobby={returnLobby} onExport={exportReplay} />}

    {panel && <div className={`jakukyo-overlay ${panel === 'log' ? 'jakukyo-drawer-overlay' : ''}`} onClick={() => setPanel(null)}><section className={`panel ${panel === 'log' ? 'log-panel' : ''}`} onClick={event => event.stopPropagation()} role="dialog" aria-modal="true" aria-label={panel === 'rules' ? '麻将规则' : panel === 'settings' ? '游戏设置' : panel === 'themes' ? '牌桌主题' : '对局记录'}><button className="icon-button panel-close" aria-label="关闭面板" onClick={() => setPanel(null)}><Icon name="close" /></button><h2>{panel === 'rules' ? '这一桌的规则' : panel === 'settings' ? '按你的节奏' : panel === 'themes' ? '换一桌风景' : '对局记录'}</h2>
      {panel === 'themes' ? <><ThemePicker value={themeId} onChange={setThemeId} /></> : panel === 'rules' ? <><p className="panel-intro">{activeMode.name} · {activeRuleVersion}</p><div className="rules-grid"><div><strong>{activeMode.players} 人</strong><span>{activeMode.handSize} 张基础手牌</span></div>{activeMode.features.map(feature => <div key={feature}><strong>{feature}</strong></div>)}</div><ul className="rule-notes">{ruleNotes.map(rule => <li key={rule}>{rule}</li>)}</ul></> : panel === 'settings' ? <><label className="setting-row"><span><strong>托管等级</strong></span><select aria-label="设置托管等级" value={activeAutoPlayDifficulty.id} onChange={event => changeAutoPlayDifficulty(event.target.value)}>{DIFFICULTIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>{exchangeThreeEnabled && <label className="setting-row"><span><strong>托管时换三张</strong></span><ExchangePolicySelect ariaLabel="设置换三张托管方式" value={activeAutoExchangeThree} onChange={changeAutoExchangeThree} /></label>}<div className="setting-row"><span><strong>快捷操作</strong></span><QuickControlButtons value={snapshot?.quickControls ?? quickPreferences} onChange={changeQuickControls} settings /></div><div className="setting-row"><span><strong>听牌辅助</strong></span><button className={`switch ${riichiHints ? 'on' : ''}`} role="switch" aria-checked={riichiHints} aria-label="设置听牌辅助" onClick={() => setRiichiHints(!riichiHints)}><span /></button></div><div className="setting-row auto-sort-setting"><span><strong>自动理牌</strong></span><button className={`switch ${autoSort ? 'on' : ''}`} role="switch" aria-checked={autoSort} aria-label="设置自动理牌" onClick={() => setAutoSort(!autoSort)}><span /></button></div><label className="setting-row"><span><strong>电脑出牌节奏</strong></span><select aria-label="电脑出牌节奏" value={speed} onChange={event => setSpeed(Number(event.target.value))}><option value="250">利落 · 0.25 秒</option><option value="650">舒适 · 0.65 秒</option><option value="1100">从容 · 1.1 秒</option></select></label><label className="setting-row"><span><strong>声音总开关</strong></span><button className={`switch ${sound ? 'on' : ''}`} role="switch" aria-checked={sound} aria-label="声音总开关" onClick={() => setSound(!sound)}><span /></button></label><div className="audio-controls"><VolumeSlider label="总音量" value={masterVolume} onChange={setMasterVolume} disabled={!sound} /><VolumeSlider label="动作音量" value={effectsVolume} onChange={setEffectsVolume} disabled={!sound} /><VolumeSlider label="环境音量" value={ambienceVolume} onChange={setAmbienceVolume} disabled={!sound} /><div className="audio-controls-footer"><button className="effect-preview-button" disabled={!sound || masterVolume === 0 || effectsVolume === 0} onClick={() => audioRef.current?.preview()}>试听牌声</button></div></div><div className="setting-row bgm-setting"><span><strong>背景音乐</strong></span><button className={`switch ${bgm ? 'on' : ''}`} role="switch" aria-checked={bgm} aria-label="背景音乐" onClick={() => setBgm(!bgm)}><span /></button></div><div className="music-volume"><VolumeSlider label="音乐音量" value={musicVolume} onChange={setMusicVolume} disabled={!sound || !bgm} /></div><div className="setting-row"><span><strong>和牌特效</strong></span><div className="effect-setting-actions"><button className="effect-preview-button" disabled={!winEffects} onClick={() => { audioRef.current?.previewWin('yakuman'); setPanel(null); setCelebration({ id: `preview-${Date.now()}`, tier: 3, title: '役 满', subtitle: '', playerName: '你', preview: true }); }}>预览特效</button><button className={`switch ${winEffects ? 'on' : ''}`} role="switch" aria-checked={winEffects} aria-label="和牌特效" onClick={() => { setWinEffects(!winEffects); if (winEffects) setCelebration(null); }}><span /></button></div></div><div className="settings-theme"><strong>牌桌主题</strong><ThemePicker value={themeId} onChange={setThemeId} /></div><label className="seed-field"><strong>下一场的随机种子</strong><input value={seed} onChange={event => setSeed(event.target.value)} placeholder="留空使用新牌山" maxLength={80} /></label>{session && <div className="settings-bottom"><button className="text-button" onClick={exportReplay}><Icon name="download" />导出牌谱</button><button className="text-button" onClick={returnLobby}><Icon name="home" />保存并返回大厅</button></div>}</> : <><p className="panel-intro">{activeMode.name} · {activeDifficulty.label}<br />种子 <code>{snapshot?.seed ?? '—'}</code></p><div className="log-list">{snapshot?.log.map(entry => <div key={entry.id}><span>{String(entry.id).padStart(3, '0')}</span><p>{displayScoringText(entry.text, snapshot?.mode, scoringPlayers)}</p></div>)}<div ref={logEnd} /></div><button className="text-button" onClick={exportReplay}><Icon name="download" />导出牌谱</button></>}
    </section></div>}
    {showRivers && snapshot && <RiverOverview snapshot={snapshot} theme={theme} highlightedTile={highlightedTile} onClose={() => setShowRivers(false)} />}
    {experiencePanel === 'library' && <ReplayLibrary theme={theme} onClose={() => setExperiencePanel(null)} />}
    {experiencePanel === 'stats' && <ExperienceDialog title="本地战绩" onClose={() => setExperiencePanel(null)}><StatsPanel onLibrary={() => openExperience('library')} /></ExperienceDialog>}
    {experiencePanel === 'help' && <ExperienceDialog title="新手帮助" onClose={() => setExperiencePanel(null)}><HelpCenter key={helpLesson} initialLesson={helpLesson} mode={activeMode.id} theme={theme} sichuanRules={isSichuan ? ruleNotes : undefined} sichuanVersion={isSichuan ? activeSichuanOptions.version : undefined} onRules={() => { setExperiencePanel(null); setPanel('rules'); }} /></ExperienceDialog>}
    {unsavedNext && <div className="storage-warning"><ExperienceDialog title="本地记录未能保存" onClose={() => setUnsavedNext(null)}><p>牌谱或存档未能写入本地。继续后仍可游戏，但关闭或刷新页面可能丢失未保存的记录。</p><div className="storage-warning-actions"><button className="action-button pass-button" type="button" onClick={() => setUnsavedNext(null)}>留在结算页</button><button className="primary-button" type="button" onClick={() => dispatch(unsavedNext, true)}>继续下一局</button></div></ExperienceDialog></div>}
    {feedbackEvent && snapshot && <WinFeedback key={feedbackEvent.id} event={feedbackEvent} snapshot={snapshot} reduced={reducedMotion || !winEffects} onDone={() => setFeedbackEvent(null)} />}
    {celebration && <WinCelebration effect={celebration} reduced={reducedMotion} dismiss={() => setCelebration(null)} />}
    {notice && <div className="toast" role="status">{notice}</div>}
  </div>;
}
