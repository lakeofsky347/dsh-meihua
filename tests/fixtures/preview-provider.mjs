// Local offline fixture only; this file is excluded from the installable package.
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
class OfflineAdapter extends LlmAdapter {
  seen=new Set();
  async resolveModel(provider,model){return {provider,id:model,name:'模拟解读（不调用真实 API）',context:{contextWindow:262144},maxOutputTokens:65536,defaultMaxTokens:3000,outputTokenAccounting:'includes-reasoning',reasoning:{efforts:[{id:'off',name:'关闭'},{id:'max',name:'最大'}],maxEffort:'max',defaultEffort:'off'}};}
  providerInfo(id){return {id,name:'本地演示 · 模拟供应商'};}
  async listModels(provider){return [{provider,id:'offline-demo',name:'模拟解读（不调用真实 API）'}];}
  async *stream(options){
    let record={};
    const input=options.messages?.[0]?.content?.[0]?.text??'';
    const fixedInput=input.split('\n\n【用户共享背景')[0];
    try{record=JSON.parse(fixedInput.slice(fixedInput.indexOf('{')));}catch{}
    if(options.system?.includes('背景信息提炼器')){
      const mode=process.env.DSH_DEMO_SUMMARY_MODE??'valid';
      if(mode==='failure')throw Object.assign(new Error('合成摘要供应商失败'),{code:'FIXTURE_FAILURE'});
      if(mode==='slow')await new Promise(resolve=>setTimeout(resolve,1800));
      const items=(record.messages??[]).flatMap(message=>message.text.split(/\n+/).filter(part=>part.trim()&&part.length<=400).map(quote=>({
        kind:quote.includes('？')||quote.includes('?')?'concern':'fact',
        category:/生日|出生|所在地|现居/.test(quote)?'个人信息':/喜欢|不喜欢|偏好|不接受/.test(quote)?'偏好与约束':'近期处境与目标',
        sourceMessageId:message.id,quote,
      })));
      const output=mode==='invalid'?'合成的不合格输出':JSON.stringify({items});
      yield {type:'text-delta',index:0,text:output};
      yield {type:'finish',reason:{kind:'stop'}};return;
    }
    let text=record.moduleId==='tarot'?`## 牌阵总览\n\n这是本地模拟解读，不调用真实 API。牌阵为${record.spread?.name??'塔罗'}，问题为「${record.question??'当下指引'}」。\n\n## 逐牌解读\n\n${(record.cards??[]).map(d=>`${d.positionIndex+1}. ${d.positionLabel}：${d.card.name}，${d.orientation==='reversed'?'逆位':'正位'}。${d.orientation==='reversed'?d.card.reversed:d.card.upright}`).join('\n')}\n\n## 牌间关系\n\n牌面与方向来自冻结的本地抽牌记录；这里验证流式显示，不作为真实供应商解读效果。\n\n## 可以尝试的行动\n\n记下一个今天可以实践的小步骤。`:'## 卦象总览\n\n这是用于界面验收的本地模拟内容。卦象与数字来自真实起卦算法，这段文字未调用真实供应商。\n\n## 体用与变化\n\n体卦代表此刻的立足点，用卦代表正在发生的变化。读一遍起卦过程，留意动爻所连接的本卦与变卦。\n\n## 结合所问\n\n把问题拆成今天可以看清的一件小事。卦象可以提供一个观察角度，现实判断仍依赖你掌握的信息。\n\n## 今日可做之事\n\n整理眼前的一步，给自己留一点安静。此处仅验证页面、流式显示和首次解读限制。';
    if(['xiaoliu','lenormand','liuyao'].includes(record.moduleId)){
      const result=record.result??{};
      const details=record.moduleId==='xiaoliu'?`${result.name}；农历${result.lunar?.month}月${result.lunar?.day}日${result.lunar?.hourBranch}时。${result.meaning}`:record.moduleId==='lenormand'?`${result.spread?.name}：${(result.cards??[]).map(item=>item.card.name).join('、')}。相邻组合${result.adjacentPairs?.length??0}组；镜像${result.mirrors?.length??0}组。`:`${result.primary?.title}变${result.changed?.title}，动爻${result.movingLines?.join('、')||'无'}；月建${result.calendar?.monthBranch}，日辰${result.calendar?.dayGanzhi}，旬空${result.calendar?.voidBranches?.join('、')}。`;
      text=`本地模拟解读，不调用真实 API。\n\n${details}\n\n问题：${record.question??''}。\n\n这些字段来自本地冻结结果。此回答验证流式显示、共享背景和多轮上下文；真实供应商语义质量尚未验证。`;
    }
    const questions=(options.messages??[]).filter(message=>message.role==='user');
    if(questions.length>1){
      const question=questions.at(-1).content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
      const answers=(options.messages??[]).filter(message=>message.role==='assistant');
      const previous=answers.at(-1)?.content.filter(block=>block.type==='text').map(block=>block.text).join(' ').slice(0,120)??'';
      text=`这是第 ${questions.length-1} 轮本地模拟追问，不调用真实 API。\n\n你问的是：${question}\n\n我收到的上一轮回答摘要：${previous}\n\n固定${['tarot','lenormand'].includes(record.moduleId)?'牌序':record.moduleId==='xiaoliu'?'起课':'卦象'}仍来自最初记录，之前的问答已按顺序传入。这个模拟回答用于验证多轮上下文、流式显示和取消恢复，实际建议需要所选真实模型解读。`;
    }
    const key=fixedInput;
    const interrupt=process.env.DSH_DEMO_MAX_TOKENS_ONCE==='1'&&!this.seen.has(key);
    this.seen.add(key);
    if(process.env.DSH_DEMO_LONG==='1')text+='\n\n## 更多白话说明\n\n'+Array.from({length:35},(_,i)=>`### 第 ${i+1} 个观察角度\n\n这是合成的长文验收段落，不代表真实模型判断。可以把当前问题拆成具体的小步骤，先记录已知条件，再观察行动后是否出现新的反馈。保持已有卦象或牌阵，只补充解释。\n\n- 今天可以做的一步：列出可以核实的信息。\n- 接下来观察：信息是否支持原来的想法。`).join('\n\n');
    if(options.reasoningEffort==='max'){yield {type:'reasoning-delta',index:0,text:'合成思考进度，仅用于阶段验证。'};await new Promise(resolve=>setTimeout(resolve,120));}
    if(interrupt)text=text.slice(0,1800);
    const delay=Number(process.env.DSH_DEMO_DELAY_MS??400);
    yield {type:'block-start',index:0,blockType:'text'};
    for(let i=0;i<text.length;i+=12){
      if(options.signal?.aborted){yield {type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message:'Cancelled'}}};return;}
      // Leave enough time to inspect streaming and cancel in the native UI.
      await new Promise(r=>setTimeout(r,Number.isFinite(delay)&&delay>=0?delay:400));
      yield {type:'text-delta',index:0,text:text.slice(i,i+12)};
    }
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:{kind:interrupt?'max-tokens':'stop'}};
  }
}
export function apply(ctx){ctx.llm.registerAdapter(['meihua-offline'],new OfflineAdapter());}
