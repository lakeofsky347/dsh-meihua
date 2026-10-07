import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {LENORMAND_CARDS,LENORMAND_SPREADS,LENORMAND_PAIR_EXAMPLES,lenormandCard,lenormandSpread,lenormandPair,createLenormandDeck,calculateLenormand,lenormandAssets} from '../src/lenormand/index.ts';
import type {LenormandInput} from '../src/lenormand/types.ts';

const input:LenormandInput={question:'我如何安排近期的学习？',spreadId:'line-3',cardIds:[26,13,35],createdAt:'2026-10-07T12:00:00.000Z'};
const expectedNames=['骑士','四叶草','船','房屋','树','云','蛇','棺','花束','镰刀','鞭','鸟','孩童','狐狸','熊','星','鹳','犬','塔','花园','山','岔路','鼠','心','戒指','书','信','男士','女士','百合','太阳','月亮','钥匙','鱼','锚','十字架'];

test('36张传统编号顺序固定，中文释义和原创出处完整且深度冻结',()=>{
  assert.equal(LENORMAND_CARDS.length,36);
  assert.deepEqual(LENORMAND_CARDS.map(card=>card.id),Array.from({length:36},(_,index)=>index+1));
  assert.deepEqual(LENORMAND_CARDS.map(card=>card.name),expectedNames);
  assert.equal(new Set(LENORMAND_CARDS.map(card=>card.slug)).size,36);
  for(const card of LENORMAND_CARDS){
    assert.equal(lenormandCard(card.id),card);assert.ok(card.nameEn.length>0);
    assert.equal(card.keywords.length,3);assert.ok(card.symbolism.length>=30);assert.ok(card.advice.length>=25);
    assert.ok(card.noun.length>=4);assert.ok(card.modifier.length>=15);
    assert.equal(card.license,'MIT');assert.equal(card.provenance.kind,'original');assert.equal(card.provenance.creator,'问象');
    assert.ok(card.provenance.sourceFile.endsWith(card.imagePath));
    assert.match(card.provenance.symbolReference,/^https:\/\/shop\.vermilion\.cc\//);
    assert.ok(Object.isFrozen(card));assert.ok(Object.isFrozen(card.keywords));assert.ok(Object.isFrozen(card.provenance));
    assert.equal('reversed' in card,false);assert.equal('orientation' in card,false);
  }
  assert.ok(Object.isFrozen(LENORMAND_CARDS));
  for(const id of [0,37,-1,2.5,NaN])assert.throws(()=>lenormandCard(id),/1至36/);
});

test('3张与5张排列保留中牌、相邻连读及镜像对照规则，没有塔罗时间牌位',()=>{
  assert.deepEqual(LENORMAND_SPREADS.map(spread=>[spread.id,spread.cardCount]),[['line-3',3],['line-5',5]]);
  for(const spread of LENORMAND_SPREADS){assert.equal(spread.positions.length,spread.cardCount);assert.ok(spread.rules.length>=4);assert.ok(Object.isFrozen(spread.rules));assert.ok(Object.isFrozen(spread.positions));}
  assert.equal(lenormandSpread('line-3').positions[1],'中心主题');
  assert.equal(lenormandSpread('line-5').positions[2],'中心主题');
  assert.throws(()=>lenormandSpread('timeline'),/只支持/);
  assert.throws(()=>lenormandSpread('grand-tableau'),/只支持/);
});

test('Fisher–Yates注入有界随机源，36张不重复且返回冻结牌组',()=>{
  const bounds:number[]=[];
  assert.deepEqual(createLenormandDeck(max=>{bounds.push(max);return max-1;}),Array.from({length:36},(_,index)=>index+1));
  assert.deepEqual(bounds,Array.from({length:35},(_,index)=>36-index));
  assert.deepEqual(createLenormandDeck(()=>0),[...Array.from({length:35},(_,index)=>index+2),1]);
  for(let seed=1;seed<=100;seed++){
    let state=seed;
    const deck=createLenormandDeck(max=>{state=(state*1664525+1013904223)>>>0;return state%max;});
    assert.equal(new Set(deck).size,36);assert.deepEqual([...deck].sort((a,b)=>a-b),Array.from({length:36},(_,index)=>index+1));assert.ok(Object.isFrozen(deck));
  }
  for(const invalid of [-1,36,1.2,NaN,Infinity])assert.throws(()=>createLenormandDeck(()=>invalid),/随机源/);
  assert.throws(()=>createLenormandDeck(undefined as never),/随机源/);
});

test('三张固定结果围绕中牌生成两个有序组合，计算纯本地且不修改输入',()=>{
  const original=structuredClone(input);const result=calculateLenormand(input);
  assert.deepEqual(input,original);assert.deepEqual(result,calculateLenormand(input));
  assert.equal(result.system,'lenormand');assert.equal(result.ruleVersion,'lenormand-line-v1');
  assert.equal(result.center.positionIndex,1);assert.equal(result.center.card.id,13);
  assert.deepEqual(result.cards.map(placed=>placed.card.id),[26,13,35]);
  assert.deepEqual(result.adjacentPairs.map(pair=>pair.indices),[[0,1],[1,2]]);
  assert.deepEqual(result.adjacentPairs.map(pair=>pair.cardIds),[[26,13],[13,35]]);
  assert.equal(result.adjacentPairs[1]?.phrase,'新的尝试需要稳定坚持');assert.equal(result.adjacentPairs[1]?.kind,'curated');
  assert.deepEqual(result.mirrors,[]);assert.ok(result.readingGuide.some(line=>line.includes('第2张「孩童」')));
  assert.ok(Object.isFrozen(result));assert.ok(Object.isFrozen(result.cards));assert.ok(Object.isFrozen(result.cards[0]));assert.ok(Object.isFrozen(result.adjacentPairs[0]?.indices));
  assert.throws(()=>{(result.cards as unknown as {card:number}[]).push({card:99});},TypeError);
});

test('五张四组相邻与两组镜像使用同一个冻结顺序，中牌不被对照替换',()=>{
  const result=calculateLenormand({...input,spreadId:'line-5',cardIds:[24,27,6,21,33]});
  assert.equal(result.center.positionIndex,2);assert.equal(result.center.card.id,6);
  assert.deepEqual(result.adjacentPairs.map(pair=>pair.indices),[[0,1],[1,2],[2,3],[3,4]]);
  assert.deepEqual(result.adjacentPairs.map(pair=>pair.cardIds),[[24,27],[27,6],[6,21],[21,33]]);
  assert.deepEqual(result.mirrors.map(pair=>pair.indices),[[0,4],[1,3]]);
  assert.deepEqual(result.mirrors.map(pair=>pair.cardIds),[[24,33],[27,21]]);
  assert.equal(result.adjacentPairs[0]?.phrase,'情感通过书面消息表达');
  assert.equal(result.adjacentPairs[1]?.phrase,'一份消息仍有含糊之处');
  assert.equal(result.adjacentPairs[3]?.phrase,'障碍需要一个关键解法');
});

test('组合方向具有实际语义差异，任意不同牌均有候选短句及来源边界',()=>{
  assert.equal(Object.keys(LENORMAND_PAIR_EXAMPLES).length,24);
  assert.equal(lenormandPair(24,27).phrase,'情感通过书面消息表达');
  assert.equal(lenormandPair(27,24).phrase,'书面消息带有情感投入');
  assert.equal(lenormandPair(21,33).phrase,'障碍需要一个关键解法');
  assert.equal(lenormandPair(33,21).phrase,'关键入口仍受到阻碍');
  for(const a of LENORMAND_CARDS)for(const b of LENORMAND_CARDS){
    if(a.id===b.id)continue;
    const pair=lenormandPair(a.id,b.id);
    assert.ok(pair.phrase.length>=8);assert.ok(pair.explanation.length>=25);assert.ok(Object.isFrozen(pair));
    assert.notEqual(pair.phrase,lenormandPair(b.id,a.id).phrase);
    if(pair.kind==='composed'){assert.ok(pair.phrase.includes(a.noun));assert.ok(pair.phrase.includes(b.modifier));assert.ok(pair.explanation.includes('不是已知事实'));}
  }
  assert.throws(()=>lenormandPair(1,1),/重复/);
});

test('冻结前拒绝数量不符、重复牌、无效编号、超限问题与无效日期',()=>{
  for(const ids of [[],[1,2],[1,2,3,4],[1,1,2],[0,2,3],[1,2,37],[1,2,2.5]])assert.throws(()=>calculateLenormand({...input,cardIds:ids}));
  assert.throws(()=>calculateLenormand({...input,spreadId:'line-5',cardIds:[1,2,3,4]}),/5张/);
  assert.throws(()=>calculateLenormand({...input,question:'字'.repeat(2001)}),/2000/);
  assert.throws(()=>calculateLenormand({...input,question:undefined as never}),/文字/);
  for(const time of ['', 'tomorrow','2026-02-30T00:00:00.000Z','2026-10-07','2026-10-07T24:00:00Z','2026-10-07T12:60:00Z','2026-10-07T12:00:00+99:00'])assert.throws(()=>calculateLenormand({...input,createdAt:time}),/ISO/);
  assert.equal(calculateLenormand({...input,createdAt:'2024-02-29T12:00:00+08:00'}).createdAt,'2024-02-29T12:00:00+08:00');
});

test('36幅原创SVG和每张哈希/许可/编号一致，客户端嵌入数据可完整回读且不引用外网',async()=>{
  const assetRoot=new URL('../src/assets/lenormand/',import.meta.url);
  const manifest=JSON.parse(await readFile(new URL('manifest.json',assetRoot),'utf8')) as {license:string;cards:{id:number;file:string;sha256:string;license:string;creator:string;provenance:string}[]};
  assert.equal(manifest.license,'MIT');assert.equal(manifest.cards.length,36);
  assert.equal((await readdir(assetRoot)).filter(file=>file.endsWith('.svg')).length,36);
  assert.equal(new Set(manifest.cards.map(card=>card.sha256)).size,36);
  assert.equal(Object.keys(lenormandAssets).length,36);assert.ok(Object.isFrozen(lenormandAssets));
  for(const card of manifest.cards){
    const svg=await readFile(new URL(card.file,assetRoot),'utf8');
    assert.equal(createHash('sha256').update(svg).digest('hex'),card.sha256);
    assert.equal(card.license,'MIT');assert.equal(card.creator,'问象');assert.ok(card.provenance.includes('Original'));
    assert.ok(svg.includes(`<title id="title">${String(card.id).padStart(2,'0')} ${lenormandCard(card.id).name}`));
    assert.match(svg,/viewBox="0 0 300 480"/);assert.match(svg,/MIT许可/);
    assert.equal(/<(?:script|image|foreignObject)|(?:href|onload|onclick)=|url\(/i.test(svg),false);
    const uri=lenormandAssets[card.id]!;assert.ok(uri.startsWith('data:image/svg+xml;utf8,'));
    assert.equal(decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length)),svg);
  }
  assert.match(await readFile(new URL('LICENSE',assetRoot),'utf8'),/Permission is hereby granted/);
});
