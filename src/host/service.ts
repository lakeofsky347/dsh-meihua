import { randomUUID } from 'node:crypto';
import { createUserMessage, createSystemMessage } from '@deepseek-ai/dsh-llm/message';
import { AssistantStreamAccumulator, assembleAssistantStream } from '@deepseek-ai/dsh-llm/assistant-stream';
import { RuleRegistry, freezeJson, isJsonValue } from '../core/rules.ts';
import type { DivinationRule, EnvironmentContributor } from '../core/types.ts';
import type { Catalog, ModelRoute, PluginConfig, Reading, RpcResult } from '../shared/protocol.ts';
import type { HostContext, LogSession, PersistenceHandle } from './platform.ts';
import { INTERPRETATION_SYSTEM, interpretationInput } from './prompt.ts';
import { object, parseInput, text } from './validation.ts';
import type { GenerationGate } from './generation-gate.ts';

/** One current reading and one first interpretation; lifetime belongs to the plugin. */
export class MeihuaService {
  readonly rules = new RuleRegistry();
  private readonly contributors = new Map<string,EnvironmentContributor>();
  private current:Reading | null = null;
  private controller:AbortController | undefined;
  private job:Promise<void> | undefined;
  private disposed = false;
  constructor(private readonly ctx:HostContext, readonly config:PluginConfig, private readonly gate?:GenerationGate) {}

  registerRule(rule:DivinationRule):()=>void { return this.rules.register(rule); }
  registerEnvironment(id:string, contributor:EnvironmentContributor):()=>void {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || this.contributors.has(id)) throw new Error('环境信息来源标识无效或重复');
    this.contributors.set(id,contributor);
    return () => { if (this.contributors.get(id) === contributor) this.contributors.delete(id); };
  }
  snapshot():Reading | null { return this.current === null ? null : freezeJson(this.current); }
  async catalog():Promise<Catalog> {
    const groups = await Promise.all(this.ctx.llm.listProviders().map(async provider => {
      try { return { ...provider, models:(await this.ctx.llm.listModels(provider.id)).map(({id,name})=>({id,name})) }; }
      catch { return { ...provider, models:[], error:'模型目录读取失败' }; }
    }));
    return { rules:this.rules.list(), providers:groups, config:this.config };
  }
  async cast(payload:unknown):Promise<Reading> {
    if (this.disposed) throw new Error('插件已停止');
    this.gate?.assertIdle();
    if (this.current?.status === 'streaming') throw new Error('请等待本次解读结束，或先取消');
    const input = parseInput(payload,this.config);
    for (const [id,contribute] of this.contributors) {
      const details = await contribute(freezeJson(input.environment));
      if (!isJsonValue(details) || Array.isArray(details) || details === null || typeof details !== 'object' || JSON.stringify(details).length > 4000) throw new Error(`环境来源 ${id} 返回了无效信息`);
      input.environment.details[id] = details;
    }
    if (this.disposed || this.snapshot()?.status === 'streaming') throw new Error('插件状态已变化，请重新起卦');
    this.gate?.assertIdle();
    this.current = { id:`meihua-${randomUUID()}`, result:this.rules.calculate(input), status:'ready', text:'' };
    return this.snapshot()!;
  }
  async interpret(id:string, route:ModelRoute):Promise<Reading> {
    const reading = this.requireReading(id);
    if (reading.status !== 'ready') throw new Error('每卦只保留第一次解读，请重新起卦开始新的一次');
    if (!this.ctx.llm.listProviders().some(p=>p.id === route.provider)) throw new Error('所选供应商已不可用');
    const models = await this.ctx.llm.listModels(route.provider);
    if (!models.some(m=>m.id === route.model)) throw new Error('所选模型已不可用，请刷新模型目录');
    if (this.current !== reading || reading.status !== 'ready' || this.disposed) throw new Error('本次卜算状态已变化');
    const release = this.gate?.acquire(reading.id);
    reading.status = 'streaming'; reading.route = { ...route };
    this.controller = new AbortController();
    this.job = this.generate(reading,this.controller).finally(()=>release?.());
    return this.snapshot()!;
  }
  cancel(id:string):Reading {
    const reading = this.requireReading(id);
    if (reading.status === 'streaming') this.controller?.abort(new Error('已取消解读'));
    return this.snapshot()!;
  }
  private requireReading(id:string):Reading {
    if (!this.current || this.current.id !== id) throw new Error('本次卜算已不存在，请重新起卦');
    return this.current;
  }
  private async generate(reading:Reading, controller:AbortController):Promise<void> {
    let handle:PersistenceHandle | undefined;
    const stream = new AssistantStreamAccumulator();
    let session:LogSession | undefined;
    let outcome:Reading['status']='failed';
    const timer = setTimeout(()=>controller.abort(new Error('解读超时')),this.config.interpretationTimeoutMs);
    const route = reading.route!;
    try {
      session = this.ctx.sessions.prepare(reading.id);
      const messages = [createUserMessage({ content:[{ type:'text',text:interpretationInput(reading.result) }], source:{ kind:'user' } })];
      const events = [
        session.append('turn/start',{turn:1}), session.append('step/start',{turn:1,step:1}),
        session.append('request/header',{ header:{config:{...route,maxTokens:this.config.maxOutputTokens}},reason:'initial' }),
        session.append('system/message',{turn:1,step:1,message:createSystemMessage(INTERPRETATION_SYSTEM)},{surfaceOp:'append'}),
        session.append('user/message',messages[0],{surfaceOp:'append'})
      ];
      handle = await this.ctx.sessionPersistence.create(session.header);
      await handle.append(events); await handle.flush();
      reading.logSessionId = session.header.id;
      controller.signal.throwIfAborted();
      let stopped = false;
      for await (const chunk of this.ctx.llm.stream({ ...route, messages, system:INTERPRETATION_SYSTEM, maxTokens:this.config.maxOutputTokens, sessionId:session.header.id, signal:controller.signal })) {
        stream.push({ time:Date.now(),chunk });
        if (chunk.type === 'text-delta') reading.text += chunk.text;
        if (chunk.type === 'finish') {
          if (chunk.reason.kind === 'stop') stopped = true;
          else if (chunk.reason.kind === 'error' || chunk.reason.kind === 'aborted') throw Object.assign(new Error(chunk.reason.failure.message),{code:chunk.reason.failure.code});
          else throw Object.assign(new Error(chunk.reason.kind === 'max-tokens' ? '解读达到输出上限，已保留收到的内容' : '模型未返回完整的文字解读'),{code:'INCOMPLETE'});
        }
      }
      controller.signal.throwIfAborted();
      if (!stopped || !reading.text.trim()) throw Object.assign(new Error('模型没有返回完整解读'),{code:'EMPTY_RESPONSE'});
      outcome = 'complete';
    } catch (error) {
      outcome = controller.signal.aborted ? 'cancelled' : 'failed';
      const reason:unknown = controller.signal.aborted ? controller.signal.reason : error;
      reading.error = { code:controller.signal.aborted ? (reason instanceof Error && reason.message === '解读超时' ? 'TIMEOUT' : 'CANCELLED') : errorCode(error), message:reason instanceof Error ? reason.message : '解读未能完成' };
    } finally {
      clearTimeout(timer);
      if (handle && session) {
        try {
          const records=stream.snapshot();
          const assembled=outcome==='complete'?assembleAssistantStream(records):undefined;
          await handle.append([
            assembled ? session.append('assistant/message',{turn:1,step:1,stream:records,message:assembled.message(route),...(assembled.usage===undefined?{}:{usage:assembled.usage})},{surfaceOp:'append'})
              : session.append('assistant/attempt',{turn:1,step:1,stream:records}),
            session.append('step/end',{turn:1,step:1}),
            session.append('turn/end',{turn:1,reason:outcome === 'complete' ? {kind:'completed'} : {kind:'error',error:{code:reading.error?.code ?? 'UNKNOWN',message:reading.error?.message ?? '解读未完成'}}})
          ]);
          await handle.flush();
        } catch { reading.error = {code:'LOG_WRITE',message:'解读内容已保留，日志写入未完成'}; }
        finally { await handle.close().catch(()=>{ reading.error={code:'LOG_WRITE',message:'解读内容已保留，日志关闭未完成'}; }); }
      }
      reading.status=outcome;
    }
  }
  async rpc(endpoint:string,payload:unknown):Promise<RpcResult> {
    try {
      if (this.disposed) throw new Error('插件已停止');
      switch (endpoint) {
        case 'catalog': return {ok:true,value:await this.catalog()};
        case 'current': return {ok:true,value:this.snapshot()};
        case 'cast': return {ok:true,value:await this.cast(payload)};
        case 'interpret': {
          const data = object(payload);
          return {ok:true,value:await this.interpret(text(data.id,100),{provider:text(data.provider,100),model:text(data.model,200)})};
        }
        case 'cancel': return {ok:true,value:this.cancel(text(object(payload).id,100))};
        default: return {ok:false,error:{code:'NOT_FOUND',message:'未找到插件操作',details:{}}};
      }
    } catch (error) { return {ok:false,error:{code:errorCode(error),message:error instanceof Error ? error.message : '操作未完成',details:{}}}; }
  }
  /** Await the owned generation before unregistering the Host contribution. */
  async dispose():Promise<void> { this.disposed = true; this.controller?.abort(new Error('插件已停止')); await this.job; this.contributors.clear(); }
}
function errorCode(error:unknown):string { return error !== null && typeof error === 'object' && 'code' in error && typeof error.code === 'string' ? error.code : 'MEIHUA_ERROR'; }
