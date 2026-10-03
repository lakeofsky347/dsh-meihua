// Local offline fixture only; this file is excluded from the installable package.
import { LlmAdapter } from '@deepseek-ai/dsh-llm';
export const inject=['llm'];
class OfflineAdapter extends LlmAdapter {
  providerInfo(id){return {id,name:'本地演示 · 模拟供应商'};}
  async listModels(provider){return [{provider,id:'offline-demo',name:'模拟解读（不调用真实 API）'}];}
  async *stream(options){
    const text='## 卦象总览\n\n这是用于界面验收的本地模拟内容。卦象与数字来自真实起卦算法，这段文字未调用真实供应商。\n\n## 体用与变化\n\n体卦代表此刻的立足点，用卦代表正在发生的变化。读一遍起卦过程，留意动爻所连接的本卦与变卦。\n\n## 结合所问\n\n把问题拆成今天可以看清的一件小事。卦象可以提供一个观察角度，现实判断仍依赖你掌握的信息。\n\n## 今日可做之事\n\n整理眼前的一步，给自己留一点安静。此处仅验证页面、流式显示和首次解读限制。';
    yield {type:'block-start',index:0,blockType:'text'};
    for(let i=0;i<text.length;i+=12){
      if(options.signal?.aborted){yield {type:'finish',reason:{kind:'aborted',failure:{code:'ABORTED',message:'Cancelled'}}};return;}
      // Leave enough time to inspect streaming and cancel in the native UI.
      await new Promise(r=>setTimeout(r,400));
      yield {type:'text-delta',index:0,text:text.slice(i,i+12)};
    }
    yield {type:'block-end',index:0,block:{type:'text',text}};
    yield {type:'finish',reason:{kind:'stop'}};
  }
}
export function apply(ctx){ctx.llm.registerAdapter(['meihua-offline'],new OfflineAdapter());}
