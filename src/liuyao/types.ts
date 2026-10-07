import type { CastEnvironment, Element, Hexagram, Line, LunarMoment } from '../core/types.ts';

export type CoinValue = 6 | 7 | 8 | 9;
export type LiuyaoRelative = '父母' | '兄弟' | '子孙' | '妻财' | '官鬼';
export type LiuyaoSpirit = '青龙' | '朱雀' | '勾陈' | '螣蛇' | '白虎' | '玄武';
export type PalaceStage = '本宫' | '一世' | '二世' | '三世' | '四世' | '五世' | '游魂' | '归魂';
export interface LiuyaoPalace {
  name: string;
  element: Element;
  stage: PalaceStage;
  stageIndex: number;
  shi: number;
  ying: number;
}
export interface NajiaLine {
  position: number;
  yinYang: Line;
  stem: string;
  branch: string;
  najia: string;
  element: Element;
  relative: LiuyaoRelative;
  spirit: LiuyaoSpirit;
  void: boolean;
  role: '世' | '应' | '';
}
export interface LiuyaoLine extends NajiaLine {
  value: CoinValue;
  label: '老阴' | '少阳' | '少阴' | '老阳';
  moving: boolean;
  changed: NajiaLine;
}
export interface SolarTermBoundary { name: string; instant: string; localTime: string }
export interface LiuyaoCalendar {
  localDate: string;
  dayStem: string;
  dayBranch: string;
  dayGanzhi: string;
  monthBranch: string;
  monthElement: Element;
  previousJie: SolarTermBoundary;
  nextJie: SolarTermBoundary;
  xun: string;
  voidBranches: readonly [string, string];
  dayBoundary: 'civil-midnight';
  calendarVersion: 'lunar-javascript-1.7.7';
}
export interface LiuyaoInput { question: string; environment: CastEnvironment; values: readonly number[] }
export interface LiuyaoResult {
  algorithmVersion: 'liuyao-najia-v1';
  input: LiuyaoInput;
  lunar: LunarMoment;
  calendar: LiuyaoCalendar;
  primary: Hexagram;
  changed: Hexagram;
  palace: LiuyaoPalace;
  changedPalace: LiuyaoPalace;
  lines: readonly LiuyaoLine[];
  movingLines: readonly number[];
  steps: readonly string[];
  conventions: readonly string[];
}
