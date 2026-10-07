import type { HostContext } from './platform.ts';
import type { ModelRoute, ProviderGroup } from '../shared/protocol.ts';
import {object,text} from './validation.ts';
export interface BackgroundOptions {useBackground?:boolean;forOthers?:boolean}
export function parseBackgroundOptions(value:unknown):BackgroundOptions|undefined {
  if(value===undefined)return undefined;const data=object(value);
  if((data.useBackground!==undefined&&typeof data.useBackground!=='boolean')||(data.forOthers!==undefined&&typeof data.forOthers!=='boolean'))throw new Error('背景选项无效');
  return {useBackground:data.useBackground as boolean|undefined,forOthers:data.forOthers as boolean|undefined};
}
export function parseModelRoute(value:unknown):ModelRoute|undefined {
  if(value===undefined)return undefined;const data=object(value),provider=text(data.provider,100),model=text(data.model,200);
  return provider&&model?{provider,model}:undefined;
}
export async function modelCatalog(ctx:HostContext):Promise<ProviderGroup[]> {
  return Promise.all(ctx.llm.listProviders().map(async provider=>{
    try{return {...provider,models:(await ctx.llm.listModels(provider.id)).map(({id,name})=>({id,name}))};}
    catch{return {...provider,models:[],error:'模型目录读取失败'};}
  }));
}
export async function assertModelRoute(ctx:HostContext,route:ModelRoute):Promise<void> {
  if(!ctx.llm.listProviders().some(provider=>provider.id===route.provider))throw new Error('所选供应商已不可用');
  if(!(await ctx.llm.listModels(route.provider)).some(model=>model.id===route.model))throw new Error('所选模型已不可用，请刷新模型目录');
}
