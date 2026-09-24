// @ref LLP 3000.013#6 — global logout follows a rotation across app runtimes.
// A fence belongs to a principal and a generation, not just to the bearer that
// happened to be available at commit. Completed fences remain as watermarks:
// late responses from older scopes must not consume a new login's sessions.
export type GlobalFence = { principal: string; epoch: string; tokens: string[]; complete?: boolean };
export type SessionOrigin = { principal: string; epoch: string };
export function globalFences(value: unknown): value is GlobalFence[] {
  return Array.isArray(value) && value.every(item => item && typeof item.principal === "string"
    && typeof item.epoch === "string" && /^\d+$/.test(item.epoch)
    && Array.isArray(item.tokens) && item.tokens.every((token: unknown) => typeof token === "string" && token.length)
    && (item.complete === undefined || typeof item.complete === "boolean"));
}
export function mergeFences(...groups: GlobalFence[][]): GlobalFence[] {
  const merged: GlobalFence[] = [];
  for (const group of groups) for (const next of group) {
    const prior = merged.find(value => value.principal === next.principal && value.epoch === next.epoch);
    if (prior) {
      prior.complete ||= next.complete ?? false;
      prior.tokens = [...new Set([...prior.tokens, ...next.tokens])];
    } else merged.push({ ...next, tokens: [...next.tokens] });
  }
  // Pending attempts retain their retry credentials. Completed, empty fences
  // need only the newest watermark per principal, regardless of logout count.
  return merged.filter(value => !value.complete || value.tokens.length || !merged.some(other => other.complete
    && other.principal === value.principal && BigInt(other.epoch) > BigInt(value.epoch)));
}
