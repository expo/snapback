import { NativeModules } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";
import { manifestPresent } from "./witness-core";

/** SourceCode is React Native's native observation of the selected bundle. */
export function witnessRuntime() {
  const source = NativeModules.SourceCode;
  const updates = requireOptionalNativeModule<Record<string, unknown>>("ExpoUpdates");
  return { scriptURL: source?.getConstants?.().scriptURL ?? source?.scriptURL ?? null,
    dev: (globalThis as typeof globalThis & { __DEV__?: boolean }).__DEV__ !== false,
    hermes: !!(globalThis as typeof globalThis & { HermesInternal?: unknown }).HermesInternal,
    launcherManifestPresent: manifestPresent(NativeModules.EXDevLauncher?.manifestString),
    updatesPresent: updates !== null,
    updatesManifestPresent: manifestPresent(updates?.manifest) || manifestPresent(updates?.manifestString) };
}
