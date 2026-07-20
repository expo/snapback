#!/usr/bin/env node
// @ref LLP 0063#workstream-4--generated-provider-boundaries-and-a-closed-type-loop — retained Contract UI
// proof over generated Convex bindings and the native browser WebSocket client.

process.argv.push('--authoring', 'contract');
await import('./convex-realtime-web.mjs');
