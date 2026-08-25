// Shared transport-provenance classifier for client and Contract adapters.
//
// @ref LLP 0034#107-render-first-surface-mode-2026-07-09-eng-23736 — only
//   proven connectivity loss retries behind render-first UI; answered HTTP
//   failures and other diagnostics remain terminal at this adapter boundary.
// @ref LLP 0043#milestone-2-queued-mutation-replay — answered failures never
//   enter the offline mutation outbox.

// The signal is `fetchDispatchFailed`: the client stamps it exactly where
// fetch dispatch rejects and no Response exists. WHATWG runtimes use a
// TypeError for that path, while Expo/RN carriers may use a plain Error, so
// constructor identity is never a fallback. Local TypeErrors, caller aborts,
// deadlines, HTTP responses, receipts, and server refusals are not
// connectivity loss.
export const isConnectivityFailureError = (error) => (
  (error?.fetchDispatchFailed === true || error?.cause?.fetchDispatchFailed === true)
  && (
    error?.diagnostic === undefined
    || error?.diagnostic?.code === 'SNAPBACK_CLIENT_REFUSED'
  )
  && error?.name !== 'AbortError'
  && error?.cause?.name !== 'AbortError'
  && error?.name !== 'TimeoutError'
  && error?.cause?.name !== 'TimeoutError'
  && error?.status === undefined
  && error?.receipt === undefined
);
