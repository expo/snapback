import { requireOptionalNativeModule } from "expo-modules-core";
import { createWitness, type Witness, type WitnessContainer } from "./witness-core";
export type { Witness } from "./witness-core";

let instance: Witness | null | undefined;
/** Null on ordinary launches and outside an iOS simulator driven by `snapback4 witness ios`. */
export function witness(): Witness | null {
  if (instance === undefined) {
    const container = requireOptionalNativeModule<WitnessContainer>("Snapback4");
    instance = container?.witnessLaunch && JSON.parse(container.witnessLaunch).smoke === true ? null : createWitness(container);
  }
  return instance;
}
