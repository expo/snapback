import { requireOptionalNativeModule } from 'expo-modules-core';
import { nativeDevice } from 'snapback4-expo';
export const native = requireOptionalNativeModule<any>('Snapback4');
export const launch = native?.witnessLaunch ? JSON.parse(native.witnessLaunch) : null;
let ready = false;
const waiting = new Set<() => void>();
export function releaseSmoke() { ready = true; for (const start of waiting) start(); waiting.clear(); }
export const proofDevice = launch?.smoke ? { async open(...args: Parameters<typeof nativeDevice.open>) {
  const core = await nativeDevice.open(...args), attach = core.onClient;
  core.onClient = (client, origin) => {
    let stop: void | (() => void), active = true;
    const start = () => { if (active) stop = attach?.(client, origin); };
    if (ready) start(); else waiting.add(start);
    return () => { active = false; waiting.delete(start); stop?.(); };
  };
  return core;
}} : nativeDevice;
export function observation(fields: Record<string, unknown>) {
  native.witnessAppend(JSON.stringify({ np: fields, witness: { at: new Date().toISOString(), step: 'launched' } }) + '\n');
}
