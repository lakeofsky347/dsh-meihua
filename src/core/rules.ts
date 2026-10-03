import { lunarMoment } from './calendar.ts';
import { elementRelationship, hexagram, hexagramFromLines } from './hexagrams.ts';
import type { CastInput, CastResult, DivinationRule, JsonValue, RuleInfo } from './types.ts';

/** One-based remainder; exact multiples resolve to the divisor. */
export function remainder(value: number, divisor: number): number { return ((value - 1) % divisor + divisor) % divisor + 1; }

export const timeRule: DivinationRule = {
  id: 'time', name: '时间起卦', fields: [],
  calculate({ environment }) {
    const lunar = lunarMoment(environment);
    const sum = lunar.yearNumber + lunar.month + lunar.day, total = sum + lunar.hourNumber;
    return { upper: remainder(sum,8), lower: remainder(total,8), movingLine: remainder(total,6), steps: [
      `${lunar.yearBranch}年取 ${lunar.yearNumber}，${lunar.leapMonth ? '闰' : ''}${lunar.month}月取 ${lunar.month}，${lunar.day}日取 ${lunar.day}`,
      `上卦：(${lunar.yearNumber} + ${lunar.month} + ${lunar.day}) = ${sum}，除 8 取 ${remainder(sum,8)}`,
      `${lunar.hourBranch}时取 ${lunar.hourNumber}；总数 ${sum} + ${lunar.hourNumber} = ${total}`,
      `下卦：${total} 除 8 取 ${remainder(total,8)}；动爻：${total} 除 6 取 ${remainder(total,6)}`
    ] };
  }
};

export const threeNumberRule: DivinationRule = {
  id: 'three-numbers', name: '三数起卦', fields: ['a','b','c'].map((key,i) => ({ key, label: `第${['一','二','三'][i]}数`, min:1, max:999999999 })),
  calculate({ values }) {
    const a = values.a!, b = values.b!, c = values.c!, sum = a+b+c;
    return { upper: remainder(a,8), lower: remainder(b,8), movingLine: remainder(sum,6), steps: [
      `上卦：第一数 ${a} 除 8 取 ${remainder(a,8)}`,
      `下卦：第二数 ${b} 除 8 取 ${remainder(b,8)}`,
      `动爻：(${a} + ${b} + ${c}) = ${sum}，除 6 取 ${remainder(sum,6)}`,
      '本模式采用三数之和定动爻，不额外加时辰数'
    ] };
  }
};

/** Small rule registry; registration returns an unload disposer. */
export class RuleRegistry {
  private readonly rules = new Map<string, DivinationRule>();
  constructor() { this.register(timeRule); this.register(threeNumberRule); }
  register(rule: DivinationRule): () => void {
    if (!/^[a-z][a-z0-9-]*$/.test(rule.id) || this.rules.has(rule.id)) throw new Error('起卦规则标识无效或重复');
    this.rules.set(rule.id, rule);
    return () => { if (this.rules.get(rule.id) === rule) this.rules.delete(rule.id); };
  }
  list(): RuleInfo[] { return [...this.rules.values()].map(({ id,name,fields }) => ({ id,name,fields })); }
  calculate(input: CastInput): CastResult {
    const rule = this.rules.get(input.ruleId);
    if (!rule) throw new Error('未找到所选起卦规则');
    if (Object.keys(input.values).some(key => !rule.fields.some(field => field.key === key))) throw new Error('起卦参数不属于所选规则');
    for (const field of rule.fields) {
      const value = input.values[field.key];
      if (value === undefined || !Number.isSafeInteger(value) || value < field.min || value > field.max) throw new Error(`${field.label}须为 ${field.min} 至 ${field.max} 的整数`);
    }
    const frozenInput = freezeJson(input);
    const seed = rule.calculate({ values: frozenInput.values, environment: frozenInput.environment });
    if (!Number.isInteger(seed.movingLine) || seed.movingLine < 1 || seed.movingLine > 6) throw new Error('规则返回的动爻无效');
    const primary = hexagram(seed.upper, seed.lower);
    const changedLines = [...primary.lines];
    changedLines[seed.movingLine-1] = changedLines[seed.movingLine-1] === 1 ? 0 : 1;
    const changed = hexagramFromLines(changedLines);
    const mutualFromChanged = primary.number === 1 || primary.number === 2;
    const mutualSource = mutualFromChanged ? changed.lines : primary.lines;
    const mutual = hexagramFromLines([...mutualSource.slice(1,4), ...mutualSource.slice(2,5)]);
    const bodySide = seed.movingLine <= 3 ? 'upper' : 'lower';
    const body = bodySide === 'upper' ? primary.upper : primary.lower;
    const application = bodySide === 'upper' ? primary.lower : primary.upper;
    return freezeJson({ algorithmVersion:'meihua-v1', rule:{ id:rule.id, name:rule.name, fields:rule.fields }, input:frozenInput,
      lunar:lunarMoment(frozenInput.environment), primary, mutual, changed, mutualFromChanged,
      movingLine:seed.movingLine, body, application, bodySide, relationship:elementRelationship(body.element,application.element),
      steps:[...seed.steps, '爻位自下而上，动爻阴阳翻转得到变卦', mutualFromChanged ? '纯乾纯坤采用“互其变卦”：从变卦取二三四爻与三四五爻' : '互卦：二三四爻为下卦，三四五爻为上卦',
        `${seed.movingLine <= 3 ? '下' : '上'}卦动为用，${bodySide === 'upper' ? '上' : '下'}卦静为体；${elementRelationship(body.element,application.element)}`]
    });
  }
}

/** Detach JSON data and recursively freeze it before rules or providers receive it. */
export function freezeJson<T>(value: T): T {
  const copy: T = JSON.parse(JSON.stringify(value));
  const freeze = (item: unknown): void => {
    if (item !== null && typeof item === 'object') {
      for (const child of Object.values(item)) freeze(child);
      Object.freeze(item);
    }
  };
  freeze(copy); return copy;
}

/** Validate environment observations at the wire and contributor boundary. */
export function isJsonValue(value: unknown, depth = 0): value is JsonValue {
  if (depth > 12) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(v => isJsonValue(v,depth+1));
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).every(v => isJsonValue(v,depth+1));
  return false;
}
