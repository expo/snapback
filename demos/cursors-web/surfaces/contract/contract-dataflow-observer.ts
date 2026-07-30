// Dev-only dataflow observer — never statically import this from a
// production-reachable module. `getContractDataflowSnapshot` is deliberately
// absent from the narrowed `@exact/contract/runtime/production` entry that
// `exactContractWeb` substitutes in production builds (Exact 0.1.7 boundary;
// exact docs/contract-web-paved-road.md "Production runtime boundary and
// development-only inspection"). main.ts loads this module behind
// `import.meta.env.DEV`, so Vite removes it from the production client graph
// while the dev/acceptance proof keeps reading the same live dataflow
// snapshot the agent surface serves (LLP 0281 §3.5).
import { getContractDataflowSnapshot } from '@exact/contract/runtime';

export function attachDataflowFacts(target: Record<string, unknown>): void {
  target.channels = () =>
    getContractDataflowSnapshot({ component: 'CursorRoom', include: ['channels'] });
  target.receipts = () =>
    getContractDataflowSnapshot({ component: 'CursorRoom', include: ['receipts'] });
}
