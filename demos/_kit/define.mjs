// Compatibility shim (LLP 0032 P1): the authoring surface moved to
// packages/snapback-codegen/define.mjs. The definition markers are Symbols, so
// one module instance matters — this shim re-exports the package copy rather
// than duplicating it, and every historical `demos/_kit/define.mjs` import
// resolves to the same Symbols codegen checks against.

export * from '../../packages/snapback-codegen/define.mjs';
