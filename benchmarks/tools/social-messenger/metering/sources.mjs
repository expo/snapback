export const TOKEN_SOURCES = Object.freeze({
  claude: "claude-code-session-usage",
  codex: "codex-rollout-token-count",
});

export const CAP_FAMILIES = Object.freeze([
  "claude-frontier",
  "gpt-frontier",
  "mid-tier",
  "kimi-advisory",
  "grok-advisory",
]);

export const ADVISORY_CAP_FAMILIES = new Set([
  "kimi-advisory",
  "grok-advisory",
]);

export function assertCapFamily(capFamily) {
  if (!CAP_FAMILIES.includes(capFamily)) {
    throw new TypeError(`unsupported cap family: ${JSON.stringify(capFamily)}`);
  }
  return capFamily;
}
