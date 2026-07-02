// Build-only stub for the `typescript` package (ENG-22531).
//
// On the pinned Exact revision (253a39eb), the stage-0 channel capability
// import (`use pointerChannel from "@exact/contract/channels"`) reaches
// `compiler/purity-inference.ts` through module-scope value imports
// (channels.ts → exports.js → import-boundaries.js), which imports the full
// TypeScript compiler. Nothing on the browser runtime path ever CALLS the
// inference — but rolldown keeps the import, the multi-megabyte compiler
// lands in the client chunk, and its `node:*` string literals trip the
// preset's native-leak gate, failing `vite build` outright.
//
// This stub is aliased in ONLY for production builds (see vite.config.ts):
// dev semantics are untouched, and if any code path ever does call into the
// compiler at runtime it fails loudly here instead of silently shipping a
// compiler to browsers. The real fix belongs in Exact (type-only or lazy
// imports on the exports.ts → purity-inference edge).

function explode() {
  throw new Error(
    'typescript compiler is not available in the cursors-web client bundle (build-only stub, ENG-22531)',
  );
}

export default new Proxy({}, { get: () => explode() });
