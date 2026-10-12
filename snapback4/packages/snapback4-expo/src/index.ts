// The opener `snapback4/local` takes, over the Expo module: absent in
// Expo Go (which loads no custom native code), present in a development
// or production build. An app asks `nativeAvailable()` and runs the
// online tier (`snapback4/client`) when it is not.
import { requireOptionalNativeModule } from "expo-modules-core";
import type { DeviceCore, DeviceOpener } from "snapback4/local";
import { witnessRuntime } from "./witness-runtime";
import type { WitnessContainer } from "./witness-core";

interface Snapback4Native extends WitnessContainer {
  readonly documentDirectory: string;
  engineInfo?(): string;
  open(path: string, backend: string | null): Promise<number>;
  call(handle: number, request: string): Promise<string>;
  close(handle: number): void;
  readAsset(handle: number, id: string): Promise<string | null>;
  writeAsset(handle: number, id: string, hex: string): Promise<void>;
  removeAsset(handle: number, id: string): Promise<void>;
  assetUri(handle: number, id: string): string;
}

const native = requireOptionalNativeModule<Snapback4Native>("Snapback4");
// EXPO_PUBLIC_SNAPBACK_TRACE=1 logs every call's op, time and answer size.
const trace = Boolean(process.env.EXPO_PUBLIC_SNAPBACK_TRACE);
// Metro includes the runner but does not evaluate it on an ordinary launch.
const smoke = native?.witnessLaunch && JSON.parse(native.witnessLaunch).smoke === true
  ? (require("./smoke") as typeof import("./smoke")).createSmoke(native, { runtime: witnessRuntime() }) : null;

export function nativeAvailable(): boolean {
  return native !== null;
}

/** The directory the module suggests for an app's stores. */
export function documentDirectory(): string {
  if (!native) throw new Error("snapback4-expo: the native module is not in this build");
  return native.documentDirectory;
}

export const nativeDevice: DeviceOpener = {
  async engineInfo() { try { if (native?.engineInfo) return JSON.parse(native.engineInfo()); } catch {} return { format: 0, version: "unknown (unstamped)", capabilities: [] }; },
  async open(name, backend): Promise<DeviceCore> {
    if (!native) throw new Error("snapback4-expo: the native module is not in this build (Expo Go loads no custom native code; make a development build)");
    const handle = await native.open(`${native.documentDirectory.replace(/\/$/, "")}/${name}.sqlite`, backend ? JSON.stringify(backend) : null);
    const core: DeviceCore = {
      ...(smoke ? { onClient: (client, url) => smoke.attach(client, core, url) } : {}),
      media: {
        read: (id) => native.readAsset(handle, id),
        write: (id, hex) => native.writeAsset(handle, id, hex),
        remove: (id) => native.removeAsset(handle, id),
        uri: (id) => native.assetUri(handle, id),
      },
      async call(request) {
        const t0 = trace ? Date.now() : 0;
        const answer = await native.call(handle, JSON.stringify(request));
        if (trace) console.log(`snapback4-expo ${String((request as { op?: string }).op)} ${Date.now() - t0} ms ${answer.length} B`);
        return JSON.parse(answer) as Record<string, unknown>;
      },
      async close() {
        native.close(handle);
      },
    };
    return core;
  },
};
