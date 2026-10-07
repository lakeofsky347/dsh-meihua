interface SolarValue { toYmdHms(): string; getLunar(): LunarValue }
interface JieValue { getName(): string; getSolar(): SolarValue }
interface LunarValue {
  getDayGan(): string;
  getDayZhi(): string;
  getDayInGanZhi(): string;
  getPrevJie(wholeDay?: boolean): JieValue;
  getNextJie(wholeDay?: boolean): JieValue;
}
declare const calendar: {
  Solar: { fromYmdHms(year:number, month:number, day:number, hour:number, minute:number, second:number): SolarValue };
};
export = calendar;
