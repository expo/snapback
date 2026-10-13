import { requireOptionalNativeModule } from "expo-modules-core";
import { createWitness, type Witness, type WitnessContainer } from "./witness-core";
export type { Witness } from "./witness-core";

import { witnessRuntime } from "./witness-runtime";

let instance: Witness | null | undefined;
/** Null on ordinary launches and outside an iOS simulator driven by `snapback4 witness ios`. */
export function witness(): Witness | null {
  if (instance === undefined) {
    const container = requireOptionalNativeModule<WitnessContainer>("Snapback4");
    instance = container?.witnessLaunch && JSON.parse(container.witnessLaunch).smoke === true ? null : createWitness(container, witnessRuntime());
  }
  return instance;
}

/** The starter may use normal guest sign-in during prime; never on ordinary launches. */
export function smokeSegment(): "prime" | "offline" | "restart" | null {
  const container = requireOptionalNativeModule<WitnessContainer>("Snapback4");
  if (!container?.witnessLaunch) return null;
  const config = JSON.parse(container.witnessLaunch);
  return config.smoke === true && ["prime", "offline", "restart"].includes(config.segment) ? config.segment : null;
}

/** Simulator smoke uses its owned loopback backend; ordinary launches keep the app URL. */
export function smokeOrigin(fallback: string): string {
  const container = requireOptionalNativeModule<WitnessContainer>("Snapback4");
  if (!container?.witnessLaunch) return fallback;
  const config = JSON.parse(container.witnessLaunch);
  return config.smoke === true && /^http:\/\/127\.0\.0\.1:[0-9]+$/.test(config.origin) ? config.origin : fallback;
}

/** Disposable account supplied only by the owned prime smoke launch. */
export function smokeAccount(): { email: string; password: string } | null {
  const container = requireOptionalNativeModule<WitnessContainer>("Snapback4");
  if (!container?.witnessLaunch) return null;
  const config = JSON.parse(container.witnessLaunch);
  return config.smoke === true && config.segment === "prime" && typeof config.smokeAccount?.email === "string" && typeof config.smokeAccount?.password === "string" ? config.smokeAccount : null;
}
