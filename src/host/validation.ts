import { isJsonValue } from '../core/rules.ts';
import type { CastInput, EnvironmentDetails } from '../core/types.ts';
import type { PluginConfig } from '../shared/protocol.ts';

/** Plain-object parser for the authenticated but still untrusted browser wire. */
export function object(value:unknown):Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw new Error('请求格式无效');
  return value as Record<string,unknown>;
}
export function text(value:unknown, max:number, fallback = ''):string {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max) throw new Error('输入内容无效或过长');
  return value.trim();
}
export function parseInput(value:unknown, config:PluginConfig):CastInput {
  const payload = object(value), raw = object(payload.environment), values = object(payload.values);
  const parsed:Record<string,number> = {};
  for (const [key,number] of Object.entries(values)) {
    if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new Error('起卦数字须为整数');
    parsed[key] = number;
  }
  const details = object(raw.details ?? {});
  if (!isJsonValue(details) || JSON.stringify(details).length > 4000) throw new Error('环境补充信息无效或过长');
  const timeZone = text(raw.timeZone,80,config.timeZone);
  new Intl.DateTimeFormat('en',{ timeZone });
  const instant = new Date(text(raw.capturedAt,40));
  if (!Number.isFinite(instant.getTime())) throw new Error('起卦时间无效');
  return { ruleId:text(payload.ruleId,80), question:text(payload.question,500,'今日随占') || '今日随占', values:parsed,
    environment:{ capturedAt:instant.toISOString(), timeZone, details:JSON.parse(JSON.stringify(details)) as EnvironmentDetails } };
}
/** Validate deployment limits once during plugin activation. */
export function parseConfig(value:unknown):PluginConfig {
  const raw = object(value);
  const timeZone = text(raw.timeZone,80); new Intl.DateTimeFormat('en',{ timeZone });
  if (!timeZone) throw new Error('timeZone is required');
  const limit = (key:string,min:number,max:number):number => {
    const value = raw[key];
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max) throw new Error(`${key} must be an integer between ${min} and ${max}`);
    return value;
  };
  const optional=(key:string,fallback:number,min:number,max:number):number=>raw[key]===undefined?fallback:limit(key,min,max);
  return { timeZone, animationMs:limit('animationMs',0,15000), interpretationTimeoutMs:limit('interpretationTimeoutMs',1000,3600000),
    maxOutputTokens:raw.maxOutputTokens==='model-maximum'?'model-maximum':limit('maxOutputTokens',256,Number.MAX_SAFE_INTEGER),
    pollIntervalMs:limit('pollIntervalMs',100,2000),maxContextCharacters:optional('maxContextCharacters',60000,1000,10000000),
    contextSafetyTokens:optional('contextSafetyTokens',4096,256,1000000),summaryMaxOutputTokens:optional('summaryMaxOutputTokens',3000,256,32000),
    summaryTimeoutMs:optional('summaryTimeoutMs',120000,1000,600000) };
}
