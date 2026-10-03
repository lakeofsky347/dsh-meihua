import test from 'node:test';
import assert from 'node:assert/strict';
import { RuleRegistry, hexagram, hexagramFromLines, lunarMoment, wallTimeToInstant, elementRelationship } from '../src/core/index.ts';
import type { CastInput } from '../src/core/types.ts';
const env={capturedAt:'2026-10-02T04:00:00Z',timeZone:'Asia/Shanghai',details:{}};
const numbers=(a:number,b:number,c:number):CastInput=>({ruleId:'three-numbers',question:'测试',values:{a,b,c},environment:env});

test('经典观梅例：辰年十二月十七申时，革初爻动，互姤变咸',()=>{
  const r=new RuleRegistry().calculate({ruleId:'time',question:'观梅',values:{},environment:{...env,capturedAt:'2001-01-11T08:00:00Z'}});
  assert.deepEqual([r.lunar.yearNumber,r.lunar.month,r.lunar.day,r.lunar.hourNumber],[5,12,17,9]);
  assert.deepEqual([r.primary.number,r.mutual.number,r.changed.number,r.movingLine],[49,44,31,1]);
  assert.equal(r.bodySide,'upper');assert.equal(r.relationship,'用克体');
});
test('六十四卦映射完整，并且每个爻翻转两次均还原原卦',()=>{
  const ids=new Set<number>();
  for(let upper=1;upper<=8;upper++)for(let lower=1;lower<=8;lower++){
    const h=hexagram(upper,lower);ids.add(h.number);assert.equal(hexagramFromLines(h.lines).number,h.number);
    for(let i=0;i<6;i++){
      const changed=[...h.lines];changed[i]=changed[i]===1?0:1;
      const next=hexagramFromLines(changed);assert.notEqual(next.number,h.number);
      const back=[...next.lines];back[i]=back[i]===1?0:1;assert.equal(hexagramFromLines(back).number,h.number);
    }
  }
  assert.deepEqual([...ids].sort((a,b)=>a-b),Array.from({length:64},(_,i)=>i+1));
  assert.equal(hexagram(6,3).name,'既济');assert.equal(hexagram(3,6).name,'未济');
});
test('三数规则余零归八或六，冻结输入且不随动画或模型改变',()=>{
  const input=numbers(8,16,6),r=new RuleRegistry().calculate(input);
  assert.equal(r.primary.number,2);assert.equal(r.movingLine,6);assert.equal(r.bodySide,'lower');
  input.values.a=1;assert.equal(r.input.values.a,8);assert.ok(Object.isFrozen(r.input.values));
  assert.ok(r.mutualFromChanged);assert.equal(r.mutual.number,2);
  assert.throws(()=>new RuleRegistry().calculate(numbers(0,1,2)));
  assert.throws(()=>new RuleRegistry().calculate(numbers(1.5,1,2)));
});
test('农历新年、闰月、子时与零点换日按照固定约定处理',()=>{
  const at=(capturedAt:string)=>lunarMoment({...env,capturedAt});
  assert.deepEqual([at('2024-02-09T15:59:59Z').year,at('2024-02-09T15:59:59Z').month],[2023,12]);
  assert.deepEqual([at('2024-02-09T16:00:00Z').year,at('2024-02-09T16:00:00Z').month,at('2024-02-09T16:00:00Z').day],[2024,1,1]);
  assert.equal(at('2023-03-22T04:00:00Z').leapMonth,true);assert.equal(at('2023-03-22T04:00:00Z').month,2);
  assert.equal(at('2026-10-02T15:00:00Z').hourNumber,1);assert.equal(at('2026-10-02T15:00:00Z').day,22);
  assert.equal(at('2026-10-02T16:00:00Z').day,23);
  assert.equal(wallTimeToInstant('2026-10-02T12:00','Asia/Shanghai'),'2026-10-02T04:00:00.000Z');
});
test('数字方式可通过同一字段接口扩展，注册能撤销',()=>{
  const registry=new RuleRegistry();
  const dispose=registry.register({id:'two-numbers-time',name:'两数加时',fields:[{key:'a',label:'上',min:1,max:100},{key:'b',label:'下',min:1,max:100}],calculate:()=>({upper:1,lower:8,movingLine:1,steps:['扩展例']})});
  const r=registry.calculate({...numbers(1,2,3),ruleId:'two-numbers-time',values:{a:1,b:2}});
  assert.equal(r.primary.name,'否');assert.equal(r.changed.name,'无妄');
  dispose();assert.throws(()=>registry.calculate({...numbers(1,2,3),ruleId:'two-numbers-time'}));
  assert.equal(elementRelationship('金','金'),'体用比和');assert.equal(elementRelationship('木','火'),'体生用');
});
