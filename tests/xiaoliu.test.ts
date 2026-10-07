import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateXiaoliu, XIAOLIU_PALACES } from '../src/xiaoliu/index.ts';
import { wallTimeToInstant } from '../src/core/calendar.ts';
import type { CastEnvironment } from '../src/core/types.ts';
const at=(wall:string,timeZone='Asia/Shanghai'):CastEnvironment=>({capturedAt:wallTimeToInstant(wall,timeZone),timeZone,details:{}});
const cast=(wall:string)=>calculateXiaoliu({question:'核对起课',environment:at(wall)});

test('玉匣记原书例：三月初五辰时，速喜起日落大安，时落小吉',()=>{
  // 2024-04-13 = 三月初五: HKO 2024cal04.pdf, independently read/rendered.
  const r=cast('2024-04-13T08:00');
  assert.deepEqual([r.lunar.month,r.lunar.day,r.lunar.hourBranch],[3,5,'辰']);
  assert.deepEqual([r.monthPalace.name,r.dayPalace.name,r.hourPalace.name],['速喜','大安','小吉']);
  assert.equal(r.name,'小吉');assert.equal(r.element,'木');assert.match(r.meaning,/协商/);
});
test('正月初一子时含起点，十二时辰完整环绕两次',()=>{
  // HKO 2024cal02.pdf: 2024-02-10 = 正月初一.
  const expected=['大安','留连','速喜','赤口','小吉','空亡','大安','留连','速喜','赤口','小吉','空亡'];
  const hours=[0,2,4,6,8,10,12,14,16,18,20,22];
  for(let i=0;i<hours.length;i++)assert.equal(cast(`2024-02-10T${String(hours[i]).padStart(2,'0')}:00`).name,expected[i]);
});
test('零点换日而非子初换日；子时两段使用各自民用日期',()=>{
  const before=cast('2024-02-09T22:59:59'),zi=cast('2024-02-09T23:00:00'),midnight=cast('2024-02-10T00:00:00');
  assert.deepEqual([before.lunar.day,before.lunar.hourNumber],[30,12]);
  assert.deepEqual([zi.lunar.month,zi.lunar.day,zi.lunar.hourNumber],[12,30,1]);
  assert.deepEqual([midnight.lunar.month,midnight.lunar.day,midnight.lunar.hourNumber],[1,1,1]);
  assert.equal(zi.name,'小吉');assert.equal(midnight.name,'大安');
});
test('闰二月用数字二、不擅自改三月；月末初一计数',()=>{
  const r=cast('2023-03-22T00:00');
  assert.deepEqual([r.lunar.month,r.lunar.day,r.lunar.leapMonth],[2,1,true]);
  assert.equal(r.monthPalace.name,'留连');assert.equal(r.name,'留连');
  assert.equal(cast('2024-04-09T00:00').name,'速喜'); // HKO: 三月初一.
  assert.equal(cast('2024-04-08T00:00').name,'大安'); // HKO: 二月三十.
});
test('同一瞬间按所选时区读取农历日和时辰，冻结环境与结果',()=>{
  const input={question:'测试',environment:at('2024-02-10T00:00')};
  const r=calculateXiaoliu(input);
  input.environment.details.note='事后修改';input.question='改题';
  assert.equal(r.input.question,'测试');assert.deepEqual(r.input.environment.details,{});
  assert.ok(Object.isFrozen(r.hourPalace));assert.ok(Object.isFrozen(r.input.environment));
  const ny=calculateXiaoliu({question:'时区',environment:{...r.input.environment,timeZone:'America/New_York'}});
  assert.equal(ny.lunar.localTime,'2024-02-09T11:00:00');assert.equal(ny.lunar.hourBranch,'午');
});
test('六位内容齐全、释义有来源边界，非法时间与问题被拒绝',()=>{
  assert.deepEqual(XIAOLIU_PALACES.map(x=>x.name),['大安','留连','速喜','赤口','小吉','空亡']);
  assert.deepEqual(XIAOLIU_PALACES.map(x=>x.element),['木','水','火','金','木','土']);
  assert.ok(XIAOLIU_PALACES.every(x=>x.meaning&&x.keywords.length===3));
  assert.throws(()=>calculateXiaoliu({question:' ',environment:at('2024-04-13T08:00')}));
  assert.throws(()=>calculateXiaoliu({question:'q',environment:{capturedAt:'bad',timeZone:'Asia/Shanghai',details:{}}}));
  assert.throws(()=>calculateXiaoliu({question:'q',environment:at('2101-01-01T00:00')}));
});
