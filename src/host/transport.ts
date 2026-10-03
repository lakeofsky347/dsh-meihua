import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';
import type { HostContext } from './platform.ts';
import type { MeihuaService } from './service.ts';
import type { RpcResult } from '../shared/protocol.ts';

/** Exact Connection Fetch routes share DSH's /api authentication and desktop carrier.
 * DSH 0.2.0-rc.2's dedicated rpc.handle() reads webServer from its provider scope;
 * the supported exact-route registry avoids that scope dependency.
 */
export function registerTransport(ctx:HostContext,service:MeihuaService):void {
  registerModuleTransport(ctx,'meihua',service,['catalog','current','cast','interpret','cancel']);
}

export function registerModuleTransport(ctx:HostContext,namespace:string,service:{rpc(endpoint:string,payload:unknown):Promise<RpcResult>},endpoints:readonly string[]):void {
  for (const endpoint of endpoints) {
    const method=`${namespace}/${endpoint}`;
    ctx.effect(()=>ctx.connection.fetch.register({
      path:`/api/${method}`,methods:['POST'],requestBody:'buffered',
      async fetch(request) {
        if (request.headers.get('content-type')?.split(';',1)[0]?.trim().toLowerCase() !== 'application/json') return new Response('Expected application/json',{status:415});
        let body:unknown;
        try { body=await request.json(); } catch { return new Response('Invalid JSON',{status:400}); }
        const envelope=clientRequestSchema.safeParse(body);
        if (!envelope.success || envelope.data.method !== method) return new Response('Invalid RPC envelope',{status:400});
        return Response.json({type:'server-response',rpcId:envelope.data.rpcId,result:await service.rpc(endpoint,envelope.data.payload)});
      }
    }),`${namespace}: ${endpoint} RPC`);
  }
}
