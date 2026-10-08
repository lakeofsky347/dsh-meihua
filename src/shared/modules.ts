/** The internal module catalogue is shared by navigation, RPC, memory and interpretation. */
export const MODULES = [
  {id:'meihua',title:'梅花易数',subtitle:'以时与数，观象问事',index:'01',tradition:'东方 · 易象',kind:'hexagram'},
  {id:'tarot',title:'塔罗牌',subtitle:'循牌之象，照见当下',index:'02',tradition:'西方 · 秘仪',kind:'cards'},
  {id:'xiaoliu',title:'小六壬',subtitle:'月日时起课，六位循行',index:'03',tradition:'东方 · 六位',kind:'six-palaces'},
  {id:'lenormand',title:'雷诺曼',subtitle:'三五连读，象征成句',index:'04',tradition:'西方 · 小牌',kind:'cards'},
  {id:'liuyao',title:'六爻纳甲',subtitle:'六次投币，独立装卦',index:'05',tradition:'东方 · 纳甲',kind:'hexagram'},
] as const;
export type ModuleId = typeof MODULES[number]['id'];
export type NewMethodId = Exclude<ModuleId,'meihua'|'tarot'>;
export const isModuleId=(value:unknown):value is ModuleId=>MODULES.some(module=>module.id===value);
export const moduleInfo=(id:ModuleId)=>MODULES.find(module=>module.id===id)!;
export const READING_ENDPOINTS=['catalog','current','interpret','followup','resume','cancel','checkpoint','preferences'] as const;
