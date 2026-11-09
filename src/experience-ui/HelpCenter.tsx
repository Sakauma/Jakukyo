import { useState } from 'react';
import { getMode } from '../game/catalog';
import type { ModeId } from '../game/types';
import { TilePortrait } from '../table/TilePortrait';
import type { TableTheme } from '../table/themes';

const lessons = [
  { id: 'controls', name: '操作入门' },
  { id: 'riichi', name: '日麻关键' },
  { id: 'yaku', name: '常见役' },
  { id: 'score', name: '读懂计分' },
] as const;

export type HelpLessonId = (typeof lessons)[number]['id'];

const basicYaku = [
  ['役牌', '1 番／组', '白、發、中，或自己的门风、当前圈风的刻子。可以鸣牌。'],
  ['立直', '1 番', '门前清听牌时宣告，支付 1,000 点。通常只能打出之后摸入的牌。'],
  ['门前清自摸', '1 番', '保持门前清，由自己摸入和牌张。暗杠不破坏门前清。'],
  ['断幺九', '1 番', '全部使用二至八的数牌，不含一、九和字牌。本桌允许鸣牌断幺九。'],
  ['平和', '1 番', '门前清，四组顺子、非役牌雀头，并且两面听。'],
  ['一杯口', '1 番', '门前清，含同一种花色、同一组数字的两组顺子。'],
  ['七对子', '2 番', '门前清，由七种不同的对子组成。四张相同牌不能当作两个对子。'],
  ['对对和', '2 番', '四组刻子／杠与一个对子，可以鸣牌。'],
  ['混一色', '3 番／鸣牌 2 番', '只使用一种数牌花色和字牌。'],
  ['清一色', '6 番／鸣牌 5 番', '只使用一种数牌花色，不含字牌。'],
];

const illustratedSteps = [
  { title: '认识三种数牌和字牌', text: '万、筒、条各有一至九；东南西北是风牌，白發中是三元牌。相同牌通常各四张。', groups: [['m1', 'm5', 'm9'], ['p1', 'p5', 'p9'], ['s1', 's5', 's9'], ['z1', 'z2', 'z3', 'z4'], ['z5', 'z6', 'z7']], labels: ['万', '筒', '条', '风牌', '三元牌'] },
  { title: '四组面子，加一个对子', text: '同花色连续三张叫顺子，相同三张叫刻子，相同两张叫对子。这是最常见的十四张和牌形。', groups: [['m2', 'm3', 'm4'], ['p3', 'p4', 'p5'], ['s5', 's6', 's7'], ['z5', 'z5', 'z5'], ['p2', 'p2']], labels: ['顺子', '顺子', '顺子', '刻子', '对子'] },
  { title: '每巡摸一张，再打出一张', text: '自己的十三张手牌加上最右侧摸入牌，选择一张打出。吃、碰、杠会改变牌组与补牌流程，跟随合法操作按钮即可。', groups: [['m1', 'm2', 'm3', 'm6', 'm7', 'm8', 'p2', 'p3', 'p4', 's4', 's5', 's6', 'z1'], ['z7']], labels: ['原有手牌', '摸入牌'] },
  { title: '听牌之后，还要有役', text: '下例听五条、八条。门前清本身不是役；符合条件时宣告立直可获得立直役。宝牌只能加番，不能单独作为役。', groups: [['m2', 'm3', 'm4'], ['m6', 'm7', 'm8'], ['p2', 'p3', 'p4'], ['s6', 's7'], ['z5', 'z5'], ['s5', 's8']], labels: ['顺子', '顺子', '顺子', '等一张', '对子', '听张'] },
  { title: '自己打过听张，会振听', text: '同样听五条、八条时，如果自己打过五条，整组听张都不能荣和。振听仍可在满足役的条件下自摸。', groups: [['s6', 's7'], ['s5', 's8'], ['s5', 'z3', 'p1']], labels: ['手中搭子', '均不能荣和', '自己的牌河'] },
  { title: '和牌后，阅读役种和收支', text: '例如庄家三番四十符荣和，放铳者支付七千七百点。桌上若还有一根立直棒，赢家实收八千七百点，供托在明细中一并体现。', groups: [['m7', 'm8', 'm9'], ['p4', 'p5', 'p6'], ['s2', 's2'], ['s7', 's8', 's9'], ['z5', 'z5', 'z5']], labels: ['顺子', '顺子', '对子', '顺子', '白刻子'] },
];

function IllustratedGuide({ theme }: { theme: TableTheme }) {
  const [step, setStep] = useState(0);
  const current = illustratedSteps[step];
  return <section className="help-illustrated" aria-label="六步图解入门">
    <header><span>图解入门</span><small>{step + 1} / {illustratedSteps.length}</small></header>
    <h4>{current.title}</h4>
    <div className="help-tile-groups">{current.groups.map((tiles, index) => <div key={`${step}-${index}`} className={step === 4 && index === 1 ? 'is-warning' : ''}><div>{tiles.map((tile, position) => <TilePortrait key={position} tile={tile} theme={theme} />)}</div><small>{current.labels[index]}</small></div>)}</div>
    <p>{current.text}</p>
    <footer><button type="button" disabled={step === 0} onClick={() => setStep(step - 1)}>← 上一步</button><div>{illustratedSteps.map((item, index) => <button type="button" key={index} className={index === step ? 'is-active' : ''} aria-label={`入门第${index + 1}步：${item.title}`} aria-pressed={index === step} onClick={() => setStep(index)} />)}</div><button type="button" onClick={() => setStep(step === illustratedSteps.length - 1 ? 0 : step + 1)}>{step === illustratedSteps.length - 1 ? '从头回顾' : '下一步 →'}</button></footer>
  </section>;
}

export function HelpCenter({ mode, theme, onRules, initialLesson = 'controls', sichuanRules, sichuanVersion }: { mode?: ModeId; theme: TableTheme; onRules: () => void; initialLesson?: HelpLessonId; sichuanRules?: string[]; sichuanVersion?: 1 | 2 }) {
  const [lesson, setLesson] = useState<HelpLessonId>(initialLesson);
  const activeMode = getMode(mode);
  if (activeMode.id.startsWith('sichuan')) return <div className="help-center">
    <nav className="help-lessons" aria-label="帮助主题"><button type="button" className="is-selected" aria-current="page"><strong>四川规则</strong></button></nav>
    <div className="help-content">
      <div className="help-lead"><h3>先定缺，再和牌。</h3><p>点击手牌选中，再点一次或使用“打出”按钮。大厅可设置下一场的计分规则。</p></div>
      <ul className="rule-notes">{(sichuanRules ?? []).map(rule => <li key={rule}>{rule}</li>)}</ul>
      <footer className="help-mode-note"><span>当前桌规：{activeMode.name} · {sichuanVersion === 1 ? '旧版川麻计番 v1' : '川麻扩展计番 v2'}</span><button type="button" onClick={onRules}>查看本桌规则 →</button></footer>
    </div>
  </div>;
  return <div className="help-center">
    <nav className="help-lessons" aria-label="帮助主题">{lessons.map(item => <button type="button" key={item.id} aria-pressed={lesson === item.id} className={lesson === item.id ? 'is-selected' : ''} onClick={() => setLesson(item.id)}><strong>{item.name}</strong></button>)}</nav>
    <div className="help-content">
      {lesson === 'controls' && <>
        <div className="help-lead"><h3>选牌，再出牌。</h3><p>你坐在牌桌下方。轮到你时，点击一张 3D 手牌，再点一次、按 Enter，或使用“打出”按钮。</p></div>
        <IllustratedGuide theme={theme} />
        <ol className="help-steps"><li><strong>在大厅选桌</strong><p>选择玩法、电脑难度和对局长度。刚开始可用“标准”难度与“单局练习”。</p></li><li><strong>看清当前操作</strong><p>桌面下方只显示当前规则允许的吃、碰、杠、立直和和牌。出现多种吃法时，按钮上会显示具体牌组；“跳过”可放弃本次响应。</p></li><li><strong>用好辅助工具</strong><p>“理牌”整理一次，“自动理牌”保持排序；新摸入的牌独立在右侧。立直辅助可查看选定弃牌后的听张、公开未见数和振听原因。</p></li><li><strong>和牌后查看明细</strong><p>短提示之后进入结算页，可查看完整牌型、役种和四家收支。“跳过动画”只跳过演出，下一局仍由你手动开始。</p></li></ol>
        <div className="help-keyboard"><span><kbd>←</kbd><kbd>→</kbd>切换选牌</span><span><kbd>Enter</kbd>打出已选牌</span><span><kbd>Esc</kbd>取消选牌／跳过结算动画</span></div>
        <div className="help-callout"><strong>离开时保存</strong><p>点击“保存并返回大厅”，下次使用“继续上次对局”。“托管”可让电脑接手自己的操作，随时点击“接管”回到手动。</p></div>
      </>}
      {lesson === 'riichi' && <>
        <div className="help-lead"><h3>有和牌形，还需要有役。</h3><p>常见和牌形是四组顺子或刻子，加一个对子。七对子、国士无双等特殊牌形有各自要求。门前清本身不是役，宝牌也不能单独构成役。</p></div>
        <div className="help-topic-grid"><article><h4>门前清与鸣牌</h4><p>吃、碰、明杠会破坏门前清，有些役因此不再成立或减少番数。暗杠仍保留门前清。三人立直不能吃牌，拔北遵循本桌规则。</p></article><article><h4>立直</h4><p>保持门前清并进入听牌后，合法操作中会出现“立直”。选中宣言牌并打出，同时支付 1,000 点供托。立直后可获得立直役，和牌时还能查看里宝牌。</p></article><article><h4>舍牌振听</h4><p>自己曾经打过当前听张中的任意一种，这一组听张都不能荣和。换听后是否仍振听，由新的听张与自己全部牌河共同决定。</p></article><article><h4>同巡与立直后振听</h4><p>放过听张后，下一次自己摸牌前不能荣和；立直后放过和牌机会，本局都不能再荣和。振听不妨碍满足役的自摸。</p></article></div>
        
      </>}
      {lesson === 'yaku' && <>
        <div className="help-lead"><h3>先从役牌、立直、断幺九开始。</h3></div>
        <div className="help-yaku-table"><table><thead><tr><th scope="col">役</th><th scope="col">番数</th><th scope="col">要点</th></tr></thead><tbody>{basicYaku.map(([name, value, description]) => <tr key={name}><th scope="row">{name}</th><td>{value}</td><td>{description}</td></tr>)}</tbody></table></div>
        <p className="help-footnote">连风刻计 2 番；宝牌本身不构成役。</p>
      </>}
      {lesson === 'score' && <>
        <div className="help-lead"><h3>看役种，再看收支。</h3><p>符与番决定点数；结算页列出四家收支。</p></div>
        <div className="help-topic-grid"><article><h4>番与符</h4><p>番来自成立的役和宝牌；符来自牌组、雀头、听牌形与和牌方式。符番决定基本点数，庄家、闲家以及自摸、荣和采用不同支付方式。</p></article><article><h4>宝牌指示牌</h4><p>指示牌的下一种是宝牌，例如七筒指示八筒。数牌九接一；字牌按各自循环。赤五同样属于五，额外提供赤宝牌番。</p></article><article><h4>供托与本场</h4><p>立直棒的 1,000 点先进入桌上供托，由和牌者取得。本场会增加支付。结算页说明“变动前”是否已扣本局立直支出。</p></article><article><h4>流局与排名</h4><p>流局可能按听牌情况交换罚符，庄家是否连庄遵循本桌规则。最终排名以对局结束时的实际点数及规则排序为准。</p></article></div>
        <div className="help-score-example"><span>一个例子</span><strong>庄家 · 3 番 40 符 · 荣和</strong><p>放铳者支付 7,700 点。若桌上另有一根立直棒，赢家本次实收为 8,700 点；若这根棒是自己刚支付的，则相对立直前的净收益仍为 7,700 点。</p></div>
      </>}
      <footer className="help-mode-note"><span>当前桌规：{activeMode.name}</span><button type="button" onClick={onRules}>查看本桌规则 →</button></footer>
    </div>
  </div>;
}
