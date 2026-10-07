export type LenormandSpreadId = 'line-3' | 'line-5';

/** One traditional symbol, with original Chinese copy and original geometric artwork. */
export interface LenormandCard {
  id:number;
  slug:string;
  name:string;
  nameEn:string;
  keywords:readonly string[];
  symbolism:string;
  advice:string;
  /** The subject and condition used by the explicitly documented local pair grammar. */
  noun:string;
  modifier:string;
  imagePath:string;
  license:'MIT';
  provenance:{kind:'original';creator:'问象';sourceFile:string;symbolReference:string};
}
export interface LenormandSpread {
  id:LenormandSpreadId;
  name:string;
  cardCount:3 | 5;
  description:string;
  positions:readonly string[];
  rules:readonly string[];
}
export interface LenormandInput {
  question:string;
  spreadId:LenormandSpreadId;
  cardIds:readonly number[];
  createdAt:string;
}
export interface LenormandPlacedCard {positionIndex:number;positionLabel:string;card:LenormandCard}
export interface LenormandPair {
  indices:readonly [number,number];
  cardIds:readonly [number,number];
  phrase:string;
  explanation:string;
  kind:'curated' | 'composed';
}
export interface LenormandResult {
  system:'lenormand';
  ruleVersion:'lenormand-line-v1';
  question:string;
  createdAt:string;
  spread:LenormandSpread;
  cards:readonly LenormandPlacedCard[];
  center:{positionIndex:number;card:LenormandCard};
  adjacentPairs:readonly LenormandPair[];
  mirrors:readonly LenormandPair[];
  readingGuide:readonly string[];
}
