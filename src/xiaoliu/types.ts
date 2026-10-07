import type { CastEnvironment, Element, LunarMoment } from '../core/types.ts';

export type XiaoliuPalaceName = '大安' | '留连' | '速喜' | '赤口' | '小吉' | '空亡';
export interface XiaoliuPalace {
  number: number;
  name: XiaoliuPalaceName;
  element: Element;
  spirit: string;
  keywords: readonly string[];
  meaning: string;
}
export interface XiaoliuInput { question: string; environment: CastEnvironment }
export interface XiaoliuResult {
  algorithmVersion: 'xiaoliu-month-day-hour-v1';
  input: XiaoliuInput;
  lunar: LunarMoment;
  monthPalace: XiaoliuPalace;
  dayPalace: XiaoliuPalace;
  hourPalace: XiaoliuPalace;
  name: XiaoliuPalaceName;
  element: Element;
  meaning: string;
  steps: readonly string[];
  conventions: readonly string[];
}
