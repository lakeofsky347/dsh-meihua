export type TarotSpreadId = 'single' | 'timeline' | 'situation' | 'celtic-cross';
export type TarotSuit = 'wands' | 'cups' | 'swords' | 'pentacles';
export type TarotOrientation = 'upright' | 'reversed';

/** Original short Chinese interpretations, tied to a stable local deck identity. */
export interface TarotCard {
  id:string;
  name:string;
  nameEn:string;
  arcana:'major' | 'minor';
  suit?:TarotSuit;
  rank:number;
  keywords:readonly string[];
  upright:string;
  reversed:string;
}
export interface TarotSpread {
  id:TarotSpreadId;
  name:string;
  description:string;
  cardCount:number;
  positions:readonly string[];
  positionDescriptions:readonly string[];
}
export interface TarotStartInput {
  question:string;
  spreadId:TarotSpreadId;
  includeReversed:boolean;
}
/** Unrevealed positions deliberately contain no card identity or orientation. */
export interface TarotDrawnCard {
  positionIndex:number;
  positionLabel:string;
  revealed:boolean;
  card?:TarotCard;
  orientation?:TarotOrientation;
}
export interface TarotDeckInfo {
  id:'rws-78';
  name:string;
  version:'tarot-v1';
  cardCount:78;
}
/** Host-only shuffled item. Never serialize this collection to a browser. */
export interface TarotHiddenCard { card:TarotCard; orientation:TarotOrientation }
