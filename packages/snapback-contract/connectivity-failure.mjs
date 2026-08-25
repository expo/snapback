// Shared transport-provenance classifier for client and Contract adapters.
//
// @ref LLP 0034#107-render-first-surface-mode-2026-07-09-eng-23736 — only
//   proven connectivity loss retries behind render-first UI; answered HTTP
//   failures and other diagnostics remain terminal at this adapter boundary.

// The primary signal is `fetchDispatchFailed`: the client stamps it exactly
// where fetch dispatch rejects and no Response exists. WHATWG runtimes use a
// TypeError for that path, while Expo/RN carriers may use a plain Error, so
// provenance outranks constructor identity. Caller aborts, deadlines, HTTP
// responses, receipts, and server refusals are not connectivity loss.
export const isConnectivityFailureError = (error) => (
  (
    (
      (error?.fetchDispatchFailed === true || error?.cause?.fetchDispatchFailed === true)
      && (
        error?.diagnostic === undefined
        || error?.diagnostic?.code === 'SNAPBACK_CLIENT_REFUSED'
      )
    )
    || (error instanceof TypeError && error?.diagnostic === undefined)
  )
  && error?.name !== 'AbortError'
  && error?.cause?.name !== 'AbortError'
  && error?.name !== 'TimeoutError'
  && error?.cause?.name !== 'TimeoutError'
  && error?.status === undefined
  && error?.receipt === undefined
);
