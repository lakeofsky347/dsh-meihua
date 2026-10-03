import { clientRequestSchema } from '@deepseek-ai/dsh-client-connection';
import type { HostContext } from './platform.ts';
import type { MeihuaService } from './service.ts';

/** Exact Connection Fetch routes share DSH's /api authentication and desktop carrier.
 * DSH 0.2.0-rc.2's dedicated rpc.handle() reads webServer from its provider scope;
 * the supported exact-route registry avoids that scope dependency.
 */
export function registerTransport(ctx:HostContext,service:MeihuaService):void {
  for (const endpoint of ['catalog','current','cast','interpret','cancel']) {
    const method=`meihua/${endpoint}`;
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
    }),`meihua: ${endpoint} RPC`);
  }
}
