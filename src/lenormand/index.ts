export * from './types.ts';
export {lenormandAssets} from './assets.ts';
export {LENORMAND_CARDS,LENORMAND_SYMBOL_REFERENCE,lenormandCard} from './cards.ts';
export {LENORMAND_SPREADS,lenormandSpread} from './spreads.ts';
export {LENORMAND_PAIR_EXAMPLES,lenormandPair} from './combinations.ts';

import {freezeJson} from '../core/rules.ts';
import {LENORMAND_CARDS,lenormandCard} from './cards.ts';
import {lenormandSpread} from './spreads.ts';
import {lenormandPair} from './combinations.ts';
import type {LenormandInput,LenormandResult} from './types.ts';

function validIsoTime(value:unknown):value is string {
  if(typeof value!=='string')return false;
  const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(?:Z|([+-])(\d{2}):(\d{2}))$/.exec(value);
  if(!parts)return false;
  const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
  const leap=year%4===0&&(year%100!==0||year%400===0);
  const days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
  return month>=1&&month<=12&&day>=1&&day<=days[month-1]!&&Number(parts[4])<=23&&Number(parts[5])<=59&&Number(parts[6])<=59
    &&(parts[8]===undefined||Number(parts[8])<=23)&&(parts[9]===undefined||Number(parts[9])<=59)&&Number.isFinite(Date.parse(value));
}

/** Host supplies crypto.randomInt; tests can supply a deterministic bounded source. */
export function createLenormandDeck(randomBelow:(exclusiveMax:number)=>number):readonly number[] {
  if(typeof randomBelow!=='function')throw new Error('雷诺曼洗牌需要注入随机源');
  const deck=LENORMAND_CARDS.map(card=>card.id);
  for(let index=deck.length-1;index>0;index--){
    const target=randomBelow(index+1);
    if(!Number.isInteger(target)||target<0||target>index)throw new Error('雷诺曼洗牌随机源返回了无效值');
    [deck[index],deck[target]]=[deck[target]!,deck[index]!];
  }
  return freezeJson(deck);
}

/** Deterministic, local-only result. All card identity checks precede result creation. */
export function calculateLenormand(input:LenormandInput):LenormandResult {
  if(!input||typeof input.question!=='string'||input.question.length>2000)throw new Error('雷诺曼问题必须是最多2000字符的文字');
  if(!validIsoTime(input.createdAt))throw new Error('雷诺曼时间必须是有效的ISO时间');
  const spread=lenormandSpread(input.spreadId);
  if(!Array.isArray(input.cardIds)||input.cardIds.length!==spread.cardCount)throw new Error(`所选雷诺曼排列需要${spread.cardCount}张牌`);
  if(new Set(input.cardIds).size!==input.cardIds.length)throw new Error('雷诺曼抽牌不能重复');
  const cards=input.cardIds.map((id,positionIndex)=>({positionIndex,positionLabel:spread.positions[positionIndex]!,card:lenormandCard(id)}));
  const centerIndex=Math.floor(spread.cardCount/2);
  const adjacentPairs=cards.slice(0,-1).map((placed,index)=>lenormandPair(placed.card.id,cards[index+1]!.card.id,[index,index+1]));
  const mirrors=spread.cardCount===5?[lenormandPair(cards[0]!.card.id,cards[4]!.card.id,[0,4]),lenormandPair(cards[1]!.card.id,cards[3]!.card.id,[1,3])]:[];
  return freezeJson({system:'lenormand',ruleVersion:'lenormand-line-v1',question:input.question,createdAt:input.createdAt,
    spread,cards,center:{positionIndex:centerIndex,card:cards[centerIndex]!.card},adjacentPairs,mirrors,
    readingGuide:[...spread.rules,`本次以第${centerIndex+1}张「${cards[centerIndex]!.card.name}」的${cards[centerIndex]!.card.noun}为中心组织连读。`,
      '牌组符号是提示语言；先引用用户明确提供的信息，再把候选组合连接成具体的观察与行动。',
      '人物、健康、财务和事件发生时间不可从牌面推断为事实；助手推测不写入本人背景记忆。']});
}
