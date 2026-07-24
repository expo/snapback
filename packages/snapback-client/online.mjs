// Narrow Online-client entry for browser bundles that need the shared
// transport but not optional agent-custody or external-store exports.
//
// @ref LLP 0012#contract-artifacts — packaging is part of the shared adapter
// contract, and backend/capability selection must remain tree-shakeable.
// @ref LLP 0063#workstream-8--performance-and-packaging-budgets — capability
// costs stay outside consumers that do not select them.
export { SnapbackClient } from './index.mjs';
