import { localTimestamp, lunarMoment } from '../core/calendar.ts';
import { hexagramFromLines, TRIGRAMS } from '../core/hexagrams.ts';
import { freezeJson } from '../core/rules.ts';
import type { Element, Hexagram, Line } from '../core/types.ts';
import calendarLibrary from './vendor/lunar.cjs';
import type { CoinValue, LiuyaoCalendar, LiuyaoInput, LiuyaoLine, LiuyaoPalace, LiuyaoRelative, LiuyaoResult, LiuyaoSpirit, NajiaLine, PalaceStage, SolarTermBoundary } from './types.ts';
export * from './types.ts';

export const COIN_VALUES = freezeJson([6,7,8,9] as const);
export const COIN_LABELS = freezeJson({ 6:'老阴', 7:'少阳', 8:'少阴', 9:'老阳' } as const);
export const LIUYAO_SPIRITS: readonly LiuyaoSpirit[] = freezeJson(['青龙','朱雀','勾陈','螣蛇','白虎','玄武']);
export const LIUYAO_RELATIVES: readonly LiuyaoRelative[] = freezeJson(['父母','兄弟','子孙','妻财','官鬼']);
export const LIUYAO_STAGES: readonly PalaceStage[] = freezeJson(['本宫','一世','二世','三世','四世','五世','游魂','归魂']);
export const BRANCHES = freezeJson(['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'] as const);
export const STEMS = freezeJson(['甲','乙','丙','丁','戊','己','庚','辛','壬','癸'] as const);
const BRANCH_ELEMENTS: readonly Element[] = ['水','土','木','木','土','火','火','土','金','金','土','水'];
const GENERATES: Record<Element,Element> = { 木:'火',火:'土',土:'金',金:'水',水:'木' };
const OVERCOMES: Record<Element,Element> = { 木:'土',土:'水',水:'火',火:'金',金:'木' };
const SPIRIT_START=[0,0,1,1,2,3,4,4,5,5];
const SHI_POSITIONS=[6,1,2,3,4,5,4,3];

/** Every row is bottom-to-top; lower/upper trigram choose their own three entries. */
export const NAJIA_TABLE = freezeJson({
  乾:{ stems:['甲','甲','甲','壬','壬','壬'], branches:['子','寅','辰','午','申','戌'] },
  兑:{ stems:['丁','丁','丁','丁','丁','丁'], branches:['巳','卯','丑','亥','酉','未'] },
  离:{ stems:['己','己','己','己','己','己'], branches:['卯','丑','亥','酉','未','巳'] },
  震:{ stems:['庚','庚','庚','庚','庚','庚'], branches:['子','寅','辰','午','申','戌'] },
  巽:{ stems:['辛','辛','辛','辛','辛','辛'], branches:['丑','亥','酉','未','巳','卯'] },
  坎:{ stems:['戊','戊','戊','戊','戊','戊'], branches:['寅','辰','午','申','戌','子'] },
  艮:{ stems:['丙','丙','丙','丙','丙','丙'], branches:['辰','午','申','戌','子','寅'] },
  坤:{ stems:['乙','乙','乙','癸','癸','癸'], branches:['未','巳','卯','丑','亥','酉'] }
} as const);

export const LIUYAO_CONVENTIONS = freezeJson([
  '六次数值自初爻至上爻，每次三枚硬币：字面计2、背面计3；6老阴、7少阳、8少阴、9老阳。',
  '所有老阴和老阳同时翻转，允许零动爻或多动爻；本卦和变卦独立装纳甲。',
  '本卦六亲以本卦八宫五行为我；变卦对应六亲也沿用本卦宫五行，变卦自身宫属另列。',
  '世应按八宫本宫/一至五世/游魂/归魂定位，六神从当地日干自初爻顺排。',
  '月建在十二节的计算交节瞬间切换（不在中气切换，不以农历月替代），节气时刻转换为统一UTC再比较。',
  '日辰按所选时区民用零点换日；23:00不提前换日。不作经度真太阳时校正。',
  '历法支持1900至2100年；节气由随包固定的MIT历法源码计算，边界时刻为该算法版本的结果。'
]);

const PALACES = new Map<number,LiuyaoPalace>();
for (const t of TRIGRAMS) {
  let lines: Line[]=[...t.lines,...t.lines];
  for (let stage=0;stage<8;stage++) {
    if (stage>=1 && stage<=5) { const i=stage-1; lines[i]=lines[i]===1?0:1; }
    if (stage===6) lines[3]=lines[3]===1?0:1;
    if (stage===7) for (let i=0;i<3;i++) lines[i]=t.lines[i]!;
    const h=hexagramFromLines(lines),shi=SHI_POSITIONS[stage]!;
    if (PALACES.has(h.number)) throw new Error('八宫卦表重复');
    PALACES.set(h.number,freezeJson({ name:t.name,element:t.element,stage:LIUYAO_STAGES[stage]!,stageIndex:stage,shi,ying:(shi+2)%6+1 }));
  }
}
if (PALACES.size!==64) throw new Error('八宫卦表不完整');

export function palaceForHexagram(h: Pick<Hexagram,'number'>): LiuyaoPalace {
  const p=PALACES.get(h.number); if (!p) throw new Error('未找到八宫归属'); return p;
}
export function branchElement(branch: string): Element {
  const i=(BRANCHES as readonly string[]).indexOf(branch);
  if (i<0) throw new Error('地支无效'); return BRANCH_ELEMENTS[i]!;
}
export function relativeForElement(palace: Element, line: Element): LiuyaoRelative {
  if (palace===line) return '兄弟';
  if (GENERATES[line]===palace) return '父母';
  if (GENERATES[palace]===line) return '子孙';
  if (OVERCOMES[palace]===line) return '妻财';
  return '官鬼';
}

/** Solar terms are astronomical instants; only the civil day uses the requested zone. */
export function liuyaoCalendar(environment: LiuyaoInput['environment']): LiuyaoCalendar {
  lunarMoment(environment); // Validate supported instant, time zone and year before library access.
  const local=localTimestamp(environment.capturedAt,environment.timeZone);
  const parts=(wall:string)=>wall.split(/[-T:]/).map(Number) as [number,number,number,number,number,number];
  const civil=calendarLibrary.Solar.fromYmdHms(...parts(local)).getLunar();
  // Library solar-term wall times are UTC+08:00, independent of user's zone or DST.
  const beijing=calendarLibrary.Solar.fromYmdHms(...parts(localTimestamp(environment.capturedAt,'Etc/GMT-8'))).getLunar();
  const boundary=(jie:ReturnType<typeof beijing.getPrevJie>):SolarTermBoundary=>{
    const instant=new Date(`${jie.getSolar().toYmdHms().replace(' ','T')}+08:00`).toISOString();
    return { name:jie.getName(),instant,localTime:localTimestamp(instant,environment.timeZone) };
  };
  const previousJie=boundary(beijing.getPrevJie(false)),nextJie=boundary(beijing.getNextJie(false));
  const JIE_BRANCH:Record<string,string>={ 立春:'寅',惊蛰:'卯',清明:'辰',立夏:'巳',芒种:'午',小暑:'未',立秋:'申',白露:'酉',寒露:'戌',立冬:'亥',大雪:'子',小寒:'丑' };
  const monthBranch=JIE_BRANCH[previousJie.name]; if (!monthBranch) throw new Error('节气月建数据无效');
  const dayStem=civil.getDayGan(),dayBranch=civil.getDayZhi(),dayGanzhi=civil.getDayInGanZhi();
  const stemIndex=(STEMS as readonly string[]).indexOf(dayStem),branchIndex=(BRANCHES as readonly string[]).indexOf(dayBranch);
  const sexagenary=Array.from({length:60},(_,i)=>i).find(i=>i%10===stemIndex&&i%12===branchIndex);
  if (sexagenary===undefined) throw new Error('日干支数据无效');
  const xunStart=Math.floor(sexagenary/10)*10;
  const voidBranches=[BRANCHES[(xunStart+10)%12]!,BRANCHES[(xunStart+11)%12]!] as [string,string];
  return freezeJson({ localDate:local.slice(0,10),dayStem,dayBranch,dayGanzhi,monthBranch,monthElement:branchElement(monthBranch),
    previousJie,nextJie,xun:`甲${BRANCHES[xunStart%12]}旬`,voidBranches,dayBoundary:'civil-midnight',calendarVersion:'lunar-javascript-1.7.7' });
}

function decorate(h:Hexagram,position:number,palace:LiuyaoPalace,referenceElement:Element,c:LiuyaoCalendar):NajiaLine {
  const name=position<=3?h.lower.name:h.upper.name;
  const table=NAJIA_TABLE[name as keyof typeof NAJIA_TABLE];
  const stem=table.stems[position-1]!,branch=table.branches[position-1]!,element=branchElement(branch);
  const start=SPIRIT_START[(STEMS as readonly string[]).indexOf(c.dayStem)]!;
  return { position,yinYang:h.lines[position-1]!,stem,branch,najia:`${stem}${branch}`,element,
    relative:relativeForElement(referenceElement,element),spirit:LIUYAO_SPIRITS[(start+position-1)%6]!,void:c.voidBranches.includes(branch),
    role:palace.shi===position?'世':palace.ying===position?'应':'' };
}

/** Pure six-coin-value rule. Randomness belongs to Host; this function never rolls coins. */
export function calculateLiuyao(input: LiuyaoInput): LiuyaoResult {
  if (typeof input.question!=='string'||!input.question.trim()||input.question.length>4000) throw new Error('所问之事须为1至4000字符');
  if (!Array.isArray(input.values)||input.values.length!==6||input.values.some(v=>!Number.isInteger(v)||!(COIN_VALUES as readonly number[]).includes(v))) throw new Error('须按初爻至上爻提供六个6、7、8或9');
  const frozenInput=freezeJson(input),values=frozenInput.values as readonly CoinValue[],lunar=lunarMoment(frozenInput.environment),c=liuyaoCalendar(frozenInput.environment);
  const primary=hexagramFromLines(values.map(v=>v%2 as Line));
  const movingLines=values.flatMap((v,i)=>v===6||v===9?[i+1]:[]);
  const changed=hexagramFromLines(values.map(v=>(v===6?1:v===9?0:v%2) as Line));
  const palace=palaceForHexagram(primary),changedPalace=palaceForHexagram(changed);
  const lines:LiuyaoLine[]=values.map((value,i)=>({ ...decorate(primary,i+1,palace,palace.element,c),value,label:COIN_LABELS[value],moving:movingLines.includes(i+1),changed:decorate(changed,i+1,changedPalace,palace.element,c) }));
  return freezeJson({ algorithmVersion:'liuyao-najia-v1',input:frozenInput,lunar,calendar:c,primary,changed,palace,changedPalace,lines,movingLines,
    steps:[
      `六次数值按初爻到上爻：${values.join('、')}；本卦${primary.title}。`,
      movingLines.length?`第${movingLines.join('、')}爻为老阴/老阳，同时翻转，变卦${changed.title}。`:'本卦无动爻，变卦与本卦相同。',
      `本卦属${palace.name}宫${palace.element}，${palace.stage}；世在${palace.shi}爻，应在${palace.ying}爻。`,
      `下卦${primary.lower.name}取内卦纳甲，上卦${primary.upper.name}取外卦纳甲；六亲均以本卦${palace.element}宫为我。`,
      `当地${c.localDate}为${c.dayGanzhi}日，月建${c.monthBranch}（${c.previousJie.name} ${c.previousJie.localTime}起）。`,
      `${c.dayStem}日初爻起${lines[0]!.spirit}，六神依序顺排；${c.xun}，${c.voidBranches.join('、')}空。`
    ],conventions:LIUYAO_CONVENTIONS });
}
