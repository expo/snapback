// Cell configuration. Only PUBLIC values may appear here or in .env
// (EXPO_PUBLIC_* is inlined into the app bundle): the gateway origin, the
// Convex deployment URL, and the Supabase publishable key. The OpenRouter key
// and all privileged credentials live server-side (gateway / Convex env /
// Snapback config) — never in this app.
//
// `bun run env` (scripts/write-env.mjs) generates .env from the repo's local
// secrets file. Defaults below suit the iOS simulator + local gateway.

export const GATEWAY_ORIGIN = process.env.EXPO_PUBLIC_CHAT_GATEWAY ?? 'http://127.0.0.1:4470';
export const SNAPBACK_ORIGIN = process.env.EXPO_PUBLIC_SNAPBACK_ORIGIN ?? 'http://127.0.0.1:4434';
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '';
export const CONVEX_URL = process.env.EXPO_PUBLIC_CONVEX_URL ?? '';
