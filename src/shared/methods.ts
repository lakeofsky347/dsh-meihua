import type {ConversationTurn,GenerationInfo,ModelRoute,PluginConfig,ProviderGroup} from './protocol.ts';
import type {MemoryUsage} from './memory.ts';
import type {NewMethodId} from './modules.ts';
import type {CastEnvironment} from '../core/types.ts';
export interface MethodReading {
  preflight?:{id:string};
  id:string;moduleId:NewMethodId;question:string;createdAt:string;environment:CastEnvironment;
  status:'collecting'|'selecting'|'revealing'|'ready'|'streaming'|'complete'|'failed'|'cancelled';
  result:unknown|null;text:string;wallTime?:string;selectedRoute?:ModelRoute;route?:ModelRoute;error?:{code:string;message:string};conversation?:ConversationTurn[];
  memory?:MemoryUsage;logSessionId?:string;backgroundOptions:{useBackground?:boolean;forOthers?:boolean};
  generation?:GenerationInfo;
  spreadId?:string;selectedSlots:number[];selectionCount:number;coins:{faces:number[];value:number}[];
}
export interface MethodCatalog {
  moduleId:NewMethodId;providers:ProviderGroup[];config:PluginConfig;
  spreads?:readonly {id:string;name:string;count:number}[];
}
