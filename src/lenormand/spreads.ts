import {freezeJson} from '../core/rules.ts';
import type {LenormandSpread} from './types.ts';

export const LENORMAND_SPREADS:readonly LenormandSpread[]=freezeJson([
  {id:'line-3',name:'三张连读',cardCount:3,description:'中牌确定主题，左右相邻牌构成两组短句，再把三张连成与问题有关的情境。',positions:['左侧条件','中心主题','右侧展开'],rules:[
    '中间第2张是本次主题，不自动指定为现在或结果。',
    '依序读1→2与2→3：左牌给出对象，右牌限定对象如何表现。',
    '把两个相邻短句围绕中心主题连接，并对照用户问题给出可核实的行动。',
    '不使用正逆位，不把左右位置自动解释为过去或未来，不给出注定发生的结论。',
  ]},
  {id:'line-5',name:'五张对照',cardCount:5,description:'第3张为中心，四组相邻短句读出连续情境，再用1↔5与2↔4检查两端和近侧条件的呼应。',positions:['左端背景','左近条件','中心主题','右近展开','右端延伸'],rules:[
    '中间第3张是本次主题，先明确它与问题中的哪个对象有关。',
    '依序读1→2、2→3、3→4、4→5，所有短句必须与中心主题和本次问题相连接。',
    '对照1↔5与2↔4：这是空间呼应检查，不替换相邻连读，也不推断精确时间。',
    '对照仍按左对象、右条件的本地语法描述；若和相邻读法冲突，说明不同条件，不抹去冲突。',
    '不使用正逆位，不套用塔罗的现状／阻碍／建议牌位，不根据人物牌擅自确认身份。',
  ]},
]);

export function lenormandSpread(id:string):LenormandSpread {
  const spread=LENORMAND_SPREADS.find(item=>item.id===id);
  if(!spread)throw new Error('雷诺曼只支持三张连读或五张对照');
  return spread;
}
