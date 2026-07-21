// Package-private nominal identity for agent custody.
//
// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — browser
// production clients must not retain the full agent-custody implementation
// merely to validate an optional constructor capability.
const agentAuthorityFences = new WeakSet();

export function brandAgentAuthorityFence(value) {
  agentAuthorityFences.add(value);
  return value;
}

export function isAgentAuthorityFence(value) {
  return value !== null
    && (typeof value === 'object' || typeof value === 'function')
    && agentAuthorityFences.has(value);
}
