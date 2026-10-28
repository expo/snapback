# API witness: exact signature digest

Import from "snapback4/witness-web". Generated from dist declarations; types named below retain their declaration meaning.
Browser probe after registration: window.__snapback4Witness.beginForm(name, expectedArgumentSubset, button); click that element; await window.__snapback4Witness.formResult(). For awaited uploads, call witnessForm synchronously in the clicked handler, then use its supplied mutate.

```ts
export function registerWebWitness(app: App, api?: Operations): void;
export function webWitnessObserverScript(): string;
export function witnessForm<T>(app: App, event: Event | { nativeEvent: Event; }, handler: (mutate: App["mutate"]) => Promise<T>): Promise<T>;
export type WitnessReason = "not-ready" | "returned-early" | "event" | "arguments";
```
