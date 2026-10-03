import { freezeJson } from '../core/rules.ts';
import type { TarotSpread, TarotSpreadId } from './types.ts';

export const TAROT_SPREADS:readonly TarotSpread[] = freezeJson([
  {id:'single',name:'单张指引',description:'围绕眼下最值得留意的主题，抽取一张牌。',cardCount:1,positions:['当下需要关注的主题'],positionDescriptions:['这一牌位提醒你留意此刻最需要照顾的主题、心态或行动方向。']},
  {id:'timeline',name:'时间之流',description:'用三张牌梳理过去、现在与未来的可能趋势。',cardCount:3,positions:['过去','现在','未来趋势'],positionDescriptions:['观察已经形成的经历与选择，以及它们对眼前问题的影响。','辨认当前正在发生的状态，以及你此刻可以把握的因素。','在现有条件延续时可能出现的趋势，作为调整行动的参考，并非确定预言。']},
  {id:'situation',name:'问题剖面',description:'辨认眼前状态、阻碍，以及可以尝试的行动。',cardCount:3,positions:['现状','阻碍','建议'],positionDescriptions:['观察问题的核心状态，以及已经显露的线索。','辨认限制、冲突或尚未被看见的因素；阻碍也可能来自自身。','提出你可以尝试的行动或观察角度，帮助你主动回应当下。']},
  {id:'celtic-cross',name:'凯尔特十字',description:'从十个位置观察问题的背景、影响与发展趋势。',cardCount:10,positions:['现状','阻碍','目标与可能','基础','过去','近期发展','自身立场','环境影响','希望与恐惧','发展趋势'],positionDescriptions:['问题当前的核心状态，作为其他牌位的共同观察起点。','与现状交叉的压力或挑战，也可能是需要整合的助力；横置属于牌阵布局。','你希望达成的方向，以及当前能够意识到的可能性。','支撑问题的深层背景、习惯或尚未被充分意识到的原因。','与本次问题相关的近期经历，以及仍在延续的影响。','在当前条件下较近阶段可能展开的变化，不代表确定结局。','你看待问题的态度、角色，以及可以主动改变的部分。','来自他人、周围条件与外部关系的支持或限制。','你期待或担忧的结果，帮助分辨愿望、顾虑与实际线索。','综合前面牌位后，在现有条件持续时可能形成的方向；选择与行动仍可改变它。']},
]);
export function tarotSpread(id:TarotSpreadId | string):TarotSpread {
  const spread=TAROT_SPREADS.find(item=>item.id===id);
  if(!spread)throw new Error('未找到所选塔罗牌阵');
  return spread;
}
