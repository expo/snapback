import { requireOptionalNativeModule } from "expo-modules-core";
import { createWitness, type Witness, type WitnessContainer } from "./witness-core";
export type { Witness } from "./witness-core";

let instance: Witness | null | undefined;
/** Null on ordinary launches and outside an iOS simulator driven by `snapback4 witness ios`. */
export function witness(): Witness | null {
  if (instance === undefined) instance = createWitness(requireOptionalNativeModule<WitnessContainer>("Snapback4"));
  return instance;
}
