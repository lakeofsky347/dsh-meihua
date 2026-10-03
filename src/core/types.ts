/** JSON values accepted by environment contributors and persisted requests. */
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type EnvironmentDetails = Record<string, JsonValue>;
export type Line = 0 | 1;
export type Element = '金' | '木' | '水' | '火' | '土';

/** Frozen instant and optional observations; observations do not implicitly alter a rule. */
export interface CastEnvironment {
  capturedAt: string;
  timeZone: string;
  details: EnvironmentDetails;
}

export interface LunarMoment {
  year: number;
  month: number;
  day: number;
  leapMonth: boolean;
  yearBranch: string;
  yearNumber: number;
  hourBranch: string;
  hourNumber: number;
  localTime: string;
}

export interface Trigram {
  number: number;
  name: string;
  image: string;
  element: Element;
  lines: readonly [Line, Line, Line];
}

export interface Hexagram {
  number: number;
  name: string;
  title: string;
  upper: Trigram;
  lower: Trigram;
  lines: readonly Line[];
}

/** Integer-field metadata lets future numeric rules use the existing input form. */
export interface RuleField {
  key: string;
  label: string;
  min: number;
  max: number;
}

export interface RuleInfo {
  id: string;
  name: string;
  fields: readonly RuleField[];
}

export interface RuleSeed {
  upper: number;
  lower: number;
  movingLine: number;
  steps: string[];
}

/** Add a rule without changing hexagram derivation, animation, or interpretation. */
export interface DivinationRule extends RuleInfo {
  calculate(input: { values: Record<string, number>; environment: CastEnvironment }): RuleSeed;
}

export interface CastInput {
  ruleId: string;
  question: string;
  values: Record<string, number>;
  environment: CastEnvironment;
}

export interface CastResult {
  algorithmVersion: 'meihua-v1';
  rule: RuleInfo;
  input: CastInput;
  lunar: LunarMoment;
  primary: Hexagram;
  mutual: Hexagram;
  changed: Hexagram;
  mutualFromChanged: boolean;
  movingLine: number;
  body: Trigram;
  application: Trigram;
  bodySide: 'upper' | 'lower';
  relationship: string;
  steps: string[];
}

/** Optional future source of observations such as a location or manual description. */
export type EnvironmentContributor = (environment: Readonly<CastEnvironment>) => EnvironmentDetails | Promise<EnvironmentDetails>;
