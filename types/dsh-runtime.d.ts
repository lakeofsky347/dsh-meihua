/** Runtime value imports only. Service use is typed by the audited local Host faces. */
declare module '@deepseek-ai/dsh-llm/message' {
  export function createUserMessage(input:{ content:{ type:'text'; text:string }[]; source:{ kind:'user' } }): import('../src/host/platform.ts').DurableMessage;
  export function createSystemMessage(text:string): import('../src/host/platform.ts').DurableMessage;
  export function createAssistantMessage(input:{ content:{ type:'text'; text:string }[]; source:{provider:string;model:string} }): import('../src/host/platform.ts').DurableMessage;
}
declare module '@deepseek-ai/dsh-llm/assistant-stream' {
  export class AssistantStreamAccumulator {
    push(value:{ time:number; chunk:import('../src/host/platform.ts').LlmChunk }):unknown;
    snapshot():readonly unknown[];
  }
  export function assembleAssistantStream(stream:readonly unknown[]):{
    message(source:{provider:string;model:string}):import('../src/host/platform.ts').DurableMessage;
    readonly usage:import('../src/core/types.ts').JsonValue | undefined;
  };
}
declare module '*.css' { const content:string; export default content; }
declare module '*.css?inline' { const content:string; export default content; }
declare module '@deepseek-ai/dsh-client-connection' {
  export const clientRequestSchema:{safeParse(value:unknown):
    {success:true;data:{type:'client-request';rpcId:string;method:string;payload:unknown}} | {success:false}};
}
