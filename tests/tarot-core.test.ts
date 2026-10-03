import test from 'node:test';
import assert from 'node:assert/strict';
import { TAROT_CARDS, TAROT_DECK, TAROT_SPREADS, tarotCard, tarotSpread, shuffleTarotDeck } from '../src/tarot/index.ts';

test('完整78张牌固定编号，22大牌与四组14张小牌均有原创中文正逆位摘要',()=>{
  assert.equal(TAROT_CARDS.length,78);assert.equal(new Set(TAROT_CARDS.map(card=>card.id)).size,78);
  assert.equal(TAROT_CARDS.filter(card=>card.arcana==='major').length,22);
  for(let index=0;index<22;index++)assert.equal(tarotCard(`major-${String(index).padStart(2,'0')}`).rank,index);
  for(const suit of ['wands','cups','swords','pentacles']){
    assert.equal(TAROT_CARDS.filter(card=>card.suit===suit).length,14);
    for(let rank=1;rank<=14;rank++)assert.equal(tarotCard(`${suit}-${String(rank).padStart(2,'0')}`).rank,rank);
  }
  for(const card of TAROT_CARDS){
    assert.ok(card.name.trim());assert.ok(card.nameEn.trim());assert.ok(card.keywords.length>=3);assert.ok(card.upright.length>=20);assert.ok(card.reversed.length>=20);
    assert.notEqual(card.upright,card.reversed);assert.ok(Object.isFrozen(card));assert.ok(Object.isFrozen(card.keywords));
  }
  assert.equal(TAROT_DECK.cardCount,78);assert.throws(()=>tarotCard('major-22'));
  assert.equal(tarotCard('major-02').nameEn,'The High Priestess');assert.equal(tarotCard('pentacles-14').nameEn,'King of Pentacles');
});
test('四个固定牌阵的顺序、数量与牌位完整，凯尔特十字无五牌替代',()=>{
  assert.deepEqual(TAROT_SPREADS.map(spread=>[spread.id,spread.cardCount]),[['single',1],['timeline',3],['situation',3],['celtic-cross',10]]);
  assert.deepEqual(tarotSpread('single').positions,['当下需要关注的主题']);
  assert.deepEqual(tarotSpread('timeline').positions,['过去','现在','未来趋势']);
  assert.deepEqual(tarotSpread('situation').positions,['现状','阻碍','建议']);
  assert.deepEqual(tarotSpread('celtic-cross').positions,['现状','阻碍','目标与可能','基础','过去','近期发展','自身立场','环境影响','希望与恐惧','发展趋势']);
  for(const spread of TAROT_SPREADS){assert.equal(spread.cardCount,spread.positions.length);assert.equal(spread.cardCount,spread.positionDescriptions.length);assert.ok(spread.positionDescriptions.every(description=>description.trim().length>=10));assert.ok(Object.isFrozen(spread.positions));assert.ok(Object.isFrozen(spread.positionDescriptions));}
  assert.throws(()=>tarotSpread('decision'));
});
test('Fisher–Yates使用明确边界的随机源，全牌不重复，方向由冻结洗牌决定',()=>{
  const bounds:number[]=[];
  const deck=shuffleTarotDeck(true,max=>{bounds.push(max);return max-1;});
  assert.deepEqual(bounds.slice(0,77),Array.from({length:77},(_,index)=>78-index));
  assert.equal(bounds.filter(bound=>bound===2).length,79);
  assert.deepEqual(deck.map(card=>card.card.id),TAROT_CARDS.map(card=>card.id));
  assert.ok(deck.every(card=>card.orientation==='reversed'));assert.ok(Object.isFrozen(deck));
  const onlyUpright=shuffleTarotDeck(false,()=>0);
  assert.equal(new Set(onlyUpright.map(card=>card.card.id)).size,78);assert.ok(onlyUpright.every(card=>card.orientation==='upright'));
  assert.notDeepEqual(onlyUpright.map(card=>card.card.id),TAROT_CARDS.map(card=>card.id));
  for(const value of [-1,78,0.5,NaN])assert.throws(()=>shuffleTarotDeck(true,()=>value),/随机源/);
});
