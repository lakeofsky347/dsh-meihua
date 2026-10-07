import { freezeJson } from '../core/rules.ts';
import { lunarMoment } from '../core/calendar.ts';
import type { XiaoliuInput, XiaoliuPalace, XiaoliuResult } from './types.ts';
export * from './types.ts';

/** Original explanatory prose; month/day/hour order follows 玉匣记 · 李淳风六壬时课. */
export const XIAOLIU_PALACES: readonly XiaoliuPalace[] = freezeJson([
  { number:1, name:'大安', element:'木', spirit:'青龙', keywords:['稳定','守成','按步推进'], meaning:'以稳定与持续为主题，先稳住已有安排，再按步骤推进；把可以确认的条件列清楚。' },
  { number:2, name:'留连', element:'水', spirit:'玄武', keywords:['延迟','反复','耐心'], meaning:'以延迟和反复为主题，核对尚未解决的环节，预留时间；避免仅靠催促来解决问题。' },
  { number:3, name:'速喜', element:'火', spirit:'朱雀', keywords:['消息','及时','行动'], meaning:'以消息与及时行动为主题，留意反馈和沟通窗口；确认信息后采取可执行的小步骤。' },
  { number:4, name:'赤口', element:'金', spirit:'白虎', keywords:['口舌','分歧','边界'], meaning:'以沟通分歧为主题，讲清事实与边界，减少情绪化表达；重要约定先核实再答应。' },
  { number:5, name:'小吉', element:'木', spirit:'六合', keywords:['协商','合作','小成'], meaning:'以协商和合作为主题，寻找愿意配合的人与条件；用小范围尝试积累进展。' },
  { number:6, name:'空亡', element:'土', spirit:'勾陈', keywords:['信息不足','未定','核实'], meaning:'以信息不足和暂未落实为主题，先补齐证据与条件；可以暂缓承诺并保留调整余地。' }
]);
export const XIAOLIU_CONVENTIONS = freezeJson([
  '按所选时区的农历月、日和时辰起课；正月从大安起一，逐项含起点计数。',
  '闰月采用同名农历月份的数字；本规则不把闰月加一，也不使用节气月。',
  '子时为23:00至00:59；农历日仍在当地民用零点换日，不在23:00提前换日。',
  '依次显示月宫、日宫、时宫，以时宫为本课落宫；本地释义为原创提示，不作事实预测。'
]);

/** A pure local cast: no random source, provider, storage, clock or network access. */
export function calculateXiaoliu(input: XiaoliuInput): XiaoliuResult {
  if (typeof input.question !== 'string' || !input.question.trim() || input.question.length > 4000) throw new Error('所问之事须为1至4000字符');
  const frozenInput = freezeJson(input), lunar = lunarMoment(frozenInput.environment);
  const index = (n:number) => ((n % 6) + 6) % 6;
  const month = index(lunar.month-1), day = index(month+lunar.day-1), hour = index(day+lunar.hourNumber-1);
  const monthPalace=XIAOLIU_PALACES[month]!, dayPalace=XIAOLIU_PALACES[day]!, hourPalace=XIAOLIU_PALACES[hour]!;
  return freezeJson({ algorithmVersion:'xiaoliu-month-day-hour-v1', input:frozenInput, lunar,
    monthPalace, dayPalace, hourPalace, name:hourPalace.name, element:hourPalace.element, meaning:hourPalace.meaning,
    steps:[
      `当地时间 ${lunar.localTime}（${input.environment.timeZone}）：农历${lunar.leapMonth?'闰':''}${lunar.month}月${lunar.day}日${lunar.hourBranch}时；${lunar.hourBranch}时取${lunar.hourNumber}。`,
      `大安起正月，含起点数${lunar.month}步：月宫${monthPalace.name}。`,
      `${monthPalace.name}起初一，含起点数${lunar.day}步：日宫${dayPalace.name}。`,
      `${dayPalace.name}起子时，含起点数${lunar.hourNumber}步：时宫${hourPalace.name}。`,
      `零起点校验：(月${lunar.month}-1 + 日${lunar.day}-1 + 时${lunar.hourNumber}-1) mod 6 = ${hour}；落${hourPalace.name}。`
    ], conventions:XIAOLIU_CONVENTIONS });
}
