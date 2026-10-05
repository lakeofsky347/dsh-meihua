// Local offline fixture only; this file is excluded from the installable package.
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
class OfflineAdapter extends LlmAdapter {
  providerInfo(id){return {id,name:'本地演示 · 模拟供应商'};}
  async listModels(provider){return [{provider,id:'offline-demo',name:'模拟解读（不调用真实 API）'}];}
  async *stream(options){
    let record={};
    const input=options.messages?.[0]?.content?.[0]?.text??'';
    try{record=JSON.parse(input.slice(input.indexOf('{')));}catch{}
    let text=record.moduleId==='tarot'?`## 牌阵总览\n\n这是本地模拟解读，不调用真实 API。牌阵为${record.spread?.name??'塔罗'}，问题为「${record.question??'当下指引'}」。\n\n## 逐牌解读\n\n${(record.cards??[]).map(d=>`${d.positionIndex+1}. ${d.positionLabel}：${d.card.name}，${d.orientation==='reversed'?'逆位':'正位'}。${d.orientation==='reversed'?d.card.reversed:d.card.upright}`).join('\n')}\n\n## 牌间关系\n\n牌面与方向来自冻结的本地抽牌记录；这里验证流式显示，不作为真实供应商解读效果。\n\n## 可以尝试的行动\n\n记下一个今天可以实践的小步骤。`:'## 卦象总览\n\n这是用于界面验收的本地模拟内容。卦象与数字来自真实起卦算法，这段文字未调用真实供应商。\n\n## 体用与变化\n\n体卦代表此刻的立足点，用卦代表正在发生的变化。读一遍起卦过程，留意动爻所连接的本卦与变卦。\n\n## 结合所问\n\n把问题拆成今天可以看清的一件小事。卦象可以提供一个观察角度，现实判断仍依赖你掌握的信息。\n\n## 今日可做之事\n\n整理眼前的一步，给自己留一点安静。此处仅验证页面、流式显示和首次解读限制。';
    const questions=(options.messages??[]).filter(message=>message.role==='user');
    if(questions.length>1){
      const question=questions.at(-1).content.filter(block=>block.type==='text').map(block=>block.text).join('\n');
      const answers=(options.messages??[]).filter(message=>message.role==='assistant');
      const previous=answers.at(-1)?.content.filter(block=>block.type==='text').map(block=>block.text).join(' ').slice(0,120)??'';
      text=`这是第 ${questions.length-1} 轮本地模拟追问，不调用真实 API。\n\n你问的是：${question}\n\n我收到的上一轮回答摘要：${previous}\n\n固定${record.moduleId==='tarot'?'牌阵':'卦象'}仍来自最初记录，之前的问答已按顺序传入。这个模拟回答用于验证多轮上下文、流式显示和取消恢复，实际建议需要所选真实模型解读。`;
    }
    const delay=Number(process.env.DSH_DEMO_DELAY_MS??400);
    yield {type:'block-start',index:0,blockType:'text'};
    for(let i=0;i<text.length;i+=12){
      if(options.signal?.aborted){yield {type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message:'Cancelled'}}};return;}
      // Leave enough time to inspect streaming and cancel in the native UI.
      await new Promise(r=>setTimeout(r,Number.isFinite(delay)&&delay>=0?delay:400));
      yield {type:'text-delta',index:0,text:text.slice(i,i+12)};
    }
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:{kind:'stop'}};
  }
}
export function apply(ctx){ctx.llm.registerAdapter(['meihua-offline'],new OfflineAdapter());}
