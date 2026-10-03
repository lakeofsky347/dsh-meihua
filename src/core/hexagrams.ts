import type { Element, Hexagram, Line, Trigram } from './types.ts';

/** First-heaven order, with lines stored from bottom to top. */
export const TRIGRAMS: readonly Trigram[] = [
  { number: 1, name: '乾', image: '天', element: '金', lines: [1, 1, 1] },
  { number: 2, name: '兑', image: '泽', element: '金', lines: [1, 1, 0] },
  { number: 3, name: '离', image: '火', element: '火', lines: [1, 0, 1] },
  { number: 4, name: '震', image: '雷', element: '木', lines: [1, 0, 0] },
  { number: 5, name: '巽', image: '风', element: '木', lines: [0, 1, 1] },
  { number: 6, name: '坎', image: '水', element: '水', lines: [0, 1, 0] },
  { number: 7, name: '艮', image: '山', element: '土', lines: [0, 0, 1] },
  { number: 8, name: '坤', image: '地', element: '土', lines: [0, 0, 0] }
];

// Each row is an upper trigram; columns follow the same first-heaven order.
const MATRIX: readonly (readonly [number, string][])[] = [
  [[1,'乾'],[10,'履'],[13,'同人'],[25,'无妄'],[44,'姤'],[6,'讼'],[33,'遁'],[12,'否']],
  [[43,'夬'],[58,'兑'],[49,'革'],[17,'随'],[28,'大过'],[47,'困'],[31,'咸'],[45,'萃']],
  [[14,'大有'],[38,'睽'],[30,'离'],[21,'噬嗑'],[50,'鼎'],[64,'未济'],[56,'旅'],[35,'晋']],
  [[34,'大壮'],[54,'归妹'],[55,'丰'],[51,'震'],[32,'恒'],[40,'解'],[62,'小过'],[16,'豫']],
  [[9,'小畜'],[61,'中孚'],[37,'家人'],[42,'益'],[57,'巽'],[59,'涣'],[53,'渐'],[20,'观']],
  [[5,'需'],[60,'节'],[63,'既济'],[3,'屯'],[48,'井'],[29,'坎'],[39,'蹇'],[8,'比']],
  [[26,'大畜'],[41,'损'],[22,'贲'],[27,'颐'],[18,'蛊'],[4,'蒙'],[52,'艮'],[23,'剥']],
  [[11,'泰'],[19,'临'],[36,'明夷'],[24,'复'],[46,'升'],[7,'师'],[15,'谦'],[2,'坤']]
];

/** Resolve one validated first-heaven number. */
export function trigram(number: number): Trigram {
  const result = TRIGRAMS[number - 1];
  if (!Number.isInteger(number) || !result) throw new Error('八卦数须为 1 至 8');
  return result;
}

/** Build the named six-line hexagram for two trigram numbers. */
export function hexagram(upperNumber: number, lowerNumber: number): Hexagram {
  const upper = trigram(upperNumber), lower = trigram(lowerNumber);
  const entry = MATRIX[upperNumber - 1]?.[lowerNumber - 1];
  if (!entry) throw new Error('卦象数据缺失');
  const [number, name] = entry;
  return { number, name, title: upperNumber === lowerNumber ? `${name}为${upper.image}` : `${upper.image}${lower.image}${name}`, upper, lower, lines: [...lower.lines, ...upper.lines] };
}

/** Resolve bottom-to-top lines into the corresponding named hexagram. */
export function hexagramFromLines(lines: readonly Line[]): Hexagram {
  if (lines.length !== 6) throw new Error('须提供六个爻位');
  const find = (part: readonly Line[]) => {
    const match = TRIGRAMS.find(t => t.lines.every((line, i) => line === part[i]));
    if (!match) throw new Error('爻位须为阴或阳');
    return match.number;
  };
  return hexagram(find(lines.slice(3)), find(lines.slice(0, 3)));
}

/** Describe the five-element relation between the static body and moving application. */
export function elementRelationship(body: Element, application: Element): string {
  const generates: Record<Element, Element> = { 金: '水', 水: '木', 木: '火', 火: '土', 土: '金' };
  const overcomes: Record<Element, Element> = { 金: '木', 木: '土', 土: '水', 水: '火', 火: '金' };
  if (body === application) return '体用比和';
  if (generates[body] === application) return '体生用';
  if (generates[application] === body) return '用生体';
  return overcomes[body] === application ? '体克用' : '用克体';
}
