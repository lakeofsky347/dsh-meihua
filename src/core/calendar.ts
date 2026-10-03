import type { CastEnvironment, LunarMoment } from './types.ts';
const BRANCHES = ['子','丑','寅','卯','辰','巳','午','未','申','酉','戌','亥'] as const;

/** Format a wall-clock timestamp in the requested time zone. */
export function localTimestamp(instant: string, timeZone: string): string {
  const p = new Intl.DateTimeFormat('en-CA', { timeZone, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hourCycle:'h23' }).formatToParts(new Date(instant));
  const get = (type: string) => p.find(part => part.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}:${get('second')}`;
}

/** Convert one frozen instant using the runtime's full ICU Chinese calendar. */
export function lunarMoment(environment: CastEnvironment): LunarMoment {
  const date = new Date(environment.capturedAt);
  if (!Number.isFinite(date.getTime())) throw new Error('起卦时间无效');
  const parts = new Intl.DateTimeFormat('en-u-ca-chinese', { timeZone: environment.timeZone, year:'numeric', month:'numeric', day:'numeric' }).formatToParts(date);
  const get = (type: string) => parts.find(p => p.type === type)?.value;
  const year = Number(get('relatedYear'));
  const rawMonth = get('month') ?? '';
  const month = Number.parseInt(rawMonth, 10), day = Number(get('day'));
  if (!Number.isInteger(year) || month < 1 || month > 12 || day < 1 || day > 30) throw new Error('运行环境未提供完整农历数据');
  const localTime = localTimestamp(environment.capturedAt, environment.timeZone);
  const civilYear = Number(localTime.slice(0, 4));
  if (civilYear < 1900 || civilYear > 2100) throw new Error('首版支持 1900 至 2100 年的时间');
  const hour = Number(localTime.slice(11, 13));
  const yearNumber = ((year - 4) % 12 + 12) % 12 + 1;
  const hourNumber = Math.floor((hour + 1) / 2) % 12 + 1;
  return { year, month, day, leapMonth: rawMonth.endsWith('bis'), yearBranch: BRANCHES[yearNumber-1]!, yearNumber, hourBranch: BRANCHES[hourNumber-1]!, hourNumber, localTime };
}

/** Parse the date-time input as wall time in the configured zone, not the browser's zone. */
export function wallTimeToInstant(value: string, timeZone: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(value)) throw new Error('请输入完整的日期与时间');
  const wall = value.length === 16 ? `${value}:00` : value;
  const target = Date.parse(`${wall}Z`);
  let candidate = target;
  for (let i=0; i<3; i++) {
    const rendered = Date.parse(`${localTimestamp(new Date(candidate).toISOString(), timeZone)}Z`);
    candidate += target - rendered;
  }
  const instant = new Date(candidate).toISOString();
  if (localTimestamp(instant, timeZone) !== wall) throw new Error('该时区中不存在这个日期或时间');
  return instant;
}
