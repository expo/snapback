# API witness: exact signature digest

Import from "snapback4/witness-web". Generated from dist declarations; types named below retain their declaration meaning.
Browser probe after registration: window.__snapback4Witness.beginForm(name, expectedArgumentSubset, button); click that element; await window.__snapback4Witness.formResult(). For awaited uploads, call witnessForm synchronously in the clicked handler, then use its supplied mutate.

```ts
export function registerWebWitness(app: App, api?: Operations): void;
export function witnessForm<T>(app: App, event: Event | { nativeEvent: Event; }, handler: (mutate: App["mutate"]) => Promise<T>): Promise<T>;
export type WitnessReason = "not-ready" | "returned-early" | "event" | "arguments";
```

Declaration fingerprint: c07864b535bd1c0f5d44617a3af87043635ecfbb5be4f53522e51538e4bf55a5
