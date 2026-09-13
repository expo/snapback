// The opener `snapback4/native` takes, over the Expo module: absent in
// Expo Go (which loads no custom native code), present in a development
// or production build. An app asks `nativeAvailable()` and falls back to
// the TypeScript tier (`snapback4/local` over expo-sqlite) when it is not.
import { requireOptionalNativeModule } from "expo-modules-core";
import type { NativeCore, NativeOpener } from "snapback4/native";

interface Snapback4Native {
  readonly documentDirectory: string;
  open(path: string, backend: string | null): Promise<number>;
  call(handle: number, request: string): Promise<string>;
  close(handle: number): void;
}

const native = requireOptionalNativeModule<Snapback4Native>("Snapback4");
// EXPO_PUBLIC_SNAPBACK_TRACE=1 logs every call's op, time and answer size.
const trace = Boolean(process.env.EXPO_PUBLIC_SNAPBACK_TRACE);

export function nativeAvailable(): boolean {
  return native !== null;
}

/** The directory the module suggests for an app's stores. */
export function documentDirectory(): string {
  if (!native) throw new Error("snapback4-expo: the native module is not in this build");
  return native.documentDirectory;
}

export const nativeDevice: NativeOpener = {
  async open(path, backend): Promise<NativeCore> {
    if (!native) throw new Error("snapback4-expo: the native module is not in this build (Expo Go loads no custom native code; make a development build)");
    const handle = await native.open(path, backend ? JSON.stringify(backend) : null);
    return {
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
  },
};
