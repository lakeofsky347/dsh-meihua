import type { CastResult } from '../core/types.ts';

export { INTERPRETATION_SYSTEM } from './interpretation-prompts.ts';

/** Exact frozen facts sent to the selected route; source code and other chats are absent. */
export function interpretationInput(result:CastResult):string {
  return `请根据以下起卦记录完成解读：\n${JSON.stringify(result, null, 2)}`;
}
