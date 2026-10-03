export * from './types.ts';
export { TAROT_CARDS, TAROT_DECK, tarotCard } from './cards.ts';
export { TAROT_SPREADS, tarotSpread } from './spreads.ts';
import { freezeJson } from '../core/rules.ts';
import { TAROT_CARDS } from './cards.ts';
import type { TarotHiddenCard } from './types.ts';

/** Pure Fisher–Yates core; the Host supplies crypto.randomInt, tests supply a fixed source. */
export function shuffleTarotDeck(includeReversed:boolean,randomBelow:(max:number)=>number):readonly TarotHiddenCard[] {
  const next=(max:number):number=>{
    const value=randomBelow(max);
    if(!Number.isInteger(value)||value<0||value>=max)throw new Error('洗牌随机源返回了无效值');
    return value;
  };
  const cards=[...TAROT_CARDS];
  for(let index=cards.length-1;index>0;index--){
    const target=next(index+1);
    [cards[index],cards[target]]=[cards[target]!,cards[index]!];
  }
  return freezeJson(cards.map(card=>({card,orientation:includeReversed&&next(2)===1?'reversed':'upright'})));
}
