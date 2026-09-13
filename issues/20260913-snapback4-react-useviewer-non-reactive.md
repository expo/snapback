# Snapback 4: React useViewer hook lacks subscription to auth and session state changes

Status: Open
Priority: P2
Observed: 2026-09-13
Review finding: E02
Evidence: Code-traced
Baseline: `6918cccbc264cf000982b03a5a11a2cf5563f885` / Snapback 4 0.1.15
Related: [react.tsx](../snapback4/packages/snapback4/src/react.tsx), [contract.ts](../snapback4/packages/snapback4/src/contract.ts), [client.ts](../snapback4/packages/snapback4/src/client.ts), [local.ts](../snapback4/packages/snapback4/src/local.ts); [useAsset / startup lifecycle](20260913-snapback4-useviewer-and-useasset-lifecycle.md) owns the same `useViewer` hole plus `useAsset(null)` and open-without-close

## Problem and reproduction

In `snapback4/packages/snapback4/src/react.tsx`, `useViewer` is implemented as:

```typescript
// react.tsx:197
export function useViewer(): Principal | null {
  return useClient().viewer();
}
```

Unlike `useLink()` (which uses `useSyncExternalStore(subscribe, client.link, client.link)`) and `useSession()` (which subscribes via `client.onSession`), `useViewer()` directly calls `client.viewer()` during component render with **no subscription or reactive state hook**.

Furthermore, the `Client` interface in `contract.ts`:
```typescript
link(): Link;
onLink(notify: (link: Link) => void): () => void;
viewer(): Principal | null;
```
does not declare an `onViewer` event listener.

### Consequences:
1. When a user signs in (`signIn()`), signs out (`signOut()`), or switches personas, any component reading `useViewer()` does not re-render. A navigation header or user profile component continues to display `null` or the old principal until an unrelated state change causes a render.
2. In React 18 / 19 concurrent mode, reading mutable external client state during render without `useSyncExternalStore` can cause visual tearing and inconsistent UI state during concurrent transitions.

## Acceptance

- Add `onViewer(notify: (viewer: Principal | null) => void): () => void` to `Client` in `contract.ts` and implement it in `client.ts`, `local.ts`, and `mock.ts`.
- Update `useViewer()` in `react.tsx` to subscribe to viewer changes via `useSyncExternalStore`.
- Add a test verifying that calling `signIn` / `signOut` causes a component rendering `useViewer()` to re-render with the updated principal immediately.

## Implementation locations

- [packages/snapback4/src/contract.ts](file:///Users/ccheever/projects/snapback/snapback4/packages/snapback4/src/contract.ts#L103) (`Client`)
- [packages/snapback4/src/react.tsx](file:///Users/ccheever/projects/snapback/snapback4/packages/snapback4/src/react.tsx#L197-L199) (`useViewer`)
- [packages/snapback4/src/client.ts](file:///Users/ccheever/projects/snapback/snapback4/packages/snapback4/src/client.ts)
- [packages/snapback4/src/local.ts](file:///Users/ccheever/projects/snapback/snapback4/packages/snapback4/src/local.ts)
