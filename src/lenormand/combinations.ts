import {freezeJson} from '../core/rules.ts';
import {lenormandCard} from './cards.ts';
import type {LenormandPair} from './types.ts';

/** Original directional examples. These are a bounded local reading aid, not an exhaustive oracle. */
export const LENORMAND_PAIR_EXAMPLES:Readonly<Record<string,{phrase:string;explanation:string}>>=freezeJson({
  '24-27':{phrase:'情感通过书面消息表达',explanation:'心提供情感主题，信把表达方式限定为文字；可以观察一封真诚的信息，而不是断言会收到表白。'},
  '27-24':{phrase:'书面消息带有情感投入',explanation:'信是主体，心限定消息的情感色彩；先读实际措辞，不能仅凭组合推断双方关系。'},
  '25-23':{phrase:'持续约定被小消耗侵蚀',explanation:'戒指提供约定，鼠提示逐渐流失；核对责任是否因琐碎失约或担忧受到影响。'},
  '23-25':{phrase:'小消耗正在形成重复循环',explanation:'鼠提供消耗主题，戒指限定为反复结构；找出损耗为何不断重现，而不是直接断言契约破裂。'},
  '21-33':{phrase:'障碍需要一个关键解法',explanation:'山提供阻碍，钥匙提示切入点；列出真正能改变限制的条件，再实际验证。'},
  '33-21':{phrase:'关键入口仍受到阻碍',explanation:'钥匙提供已知入口，山表示延迟或障碍；区分知道解法与当前能够执行。'},
  '1-27':{phrase:'新消息以文字或通知抵达',explanation:'骑士提供到来，信限定载体；重点核对通知内容、来源和时间。'},
  '27-1':{phrase:'一份文书推动新的动向',explanation:'信提供书面内容，骑士使其进入流动；观察递送、回应或后续接触是否发生。'},
  '26-27':{phrase:'未公开内容正在被写明',explanation:'书提供未知知识，信提示书面披露；可能需要查阅材料，不假定秘密已全部揭晓。'},
  '27-26':{phrase:'文字背后仍有未说明内容',explanation:'信是已经可见的文字，书提示信息尚不完整；标出需要补充的条款或说明。'},
  '34-23':{phrase:'流动资源出现持续损耗',explanation:'鱼提供资源流，鼠说明小额消耗；用真实收支寻找漏洞，不预测投资涨跌。'},
  '23-34':{phrase:'琐碎损耗影响资源流动',explanation:'鼠提供消耗问题，鱼明确受影响的是资金或资源交换；先核对损耗是否足以影响周转。'},
  '18-19':{phrase:'伙伴支持需要明确制度边界',explanation:'犬提供可信伙伴，塔限定正式流程或距离；可靠关系仍需明确权限与责任。'},
  '19-18':{phrase:'制度之中存在可依靠的支持',explanation:'塔提供机构环境，犬提示伙伴支持；寻找明确的协助渠道，避免把私人信任等同机构承诺。'},
  '4-17':{phrase:'生活基础正在调整',explanation:'房屋提供家庭或固定环境，鹳提示变化；可对照搬迁、布局或生活方式的实际调整。'},
  '17-4':{phrase:'调整围绕新的生活基础展开',explanation:'鹳是变化本身，房屋限定落脚环境；关注变化是否让日常基础更安稳。'},
  '6-27':{phrase:'模糊信息需要文字澄清',explanation:'云提供信息缺口，信提示可核对的书面说明；先寻求材料，不能假定通知本身不实。'},
  '27-6':{phrase:'一份消息仍有含糊之处',explanation:'信提供具体文书，云表明条款或语气尚不清晰；列出阅读后仍未获得的答案。'},
  '10-25':{phrase:'迅速的决定改变一项约定',explanation:'镰刀提供切断或决断，戒指限定持续关系；确认修改或退出条款，不断言关系必定结束。'},
  '25-10':{phrase:'一项持续约定面临突然调整',explanation:'戒指是约定主体，镰刀限定突变；核对谁能作决定以及改变的实际范围。'},
  '13-35':{phrase:'新的尝试需要稳定坚持',explanation:'孩童提供小起点，锚把它限定为持续投入；从小规模形成可重复的习惯。'},
  '35-13':{phrase:'长期投入需要一个新的小起步',explanation:'锚提供稳定目标，孩童提示新方法或小规模；可以在长期方向内做有限试验。'},
  '20-9':{phrase:'公开接触带来友好的邀请',explanation:'花园提供社群环境，花束限定交流气氛；可以留意公开活动里的善意，而非保证获得赞赏。'},
  '9-20':{phrase:'善意适合在公开场合表达',explanation:'花束提供欣赏，花园限定公共环境；选择适合分享的感谢并保护私人信息。'},
});

export function lenormandPair(left:number,right:number,indices:readonly [number,number]=[0,1]):LenormandPair {
  const a=lenormandCard(left),b=lenormandCard(right);
  if(left===right)throw new Error('雷诺曼组合不能使用重复牌');
  const known=LENORMAND_PAIR_EXAMPLES[`${left}-${right}`];
  return freezeJson({indices:[...indices] as [number,number],cardIds:[left,right] as [number,number],
    phrase:known?.phrase??`${a.noun}${b.modifier}。`,
    explanation:known?.explanation??`以「${a.name}」的${a.noun}为对象，用「${b.name}」限定其表现方式；这是本地组合语法的候选短句，需围绕问题和中牌检查，不是已知事实或固定预言。`,
    kind:known?'curated':'composed'});
}
