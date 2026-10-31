# PUB051 sibling audit

Scope: all exported React hooks; localUnavailable call sites in local.ts; app-client guard; files/saveAsset; uploads/device storage reads; pending sources; seen-progress.

- useAsset: automatic mounted read could retain terminal E_STORE forever; fixed loading/readiness/failure subscription. Only unresolved opening reads receive the new wakeup: ordinary download errors keep the existing link/focus/online/cooldown policy.
- useUpload: kept-id uploadIntent lookup can precede executable storage and its catch discards the initial failure; add the same local-status subscription to refresh the snapshot, with normal effect cleanup/revision fencing. No upload-and-place action is replayed.
- useQuery/usePage/useFollowing: maintained observations schedule their reads after attachCore/startCore and failure; their existing publication algorithm owns recovery. No independent final opening refusal in the hook.
- usePendingWrite/usePendingWrites/usePendingItems/usePendingState: underlying pending/intent sources subscribe to notifications; local startCore/recovery and failure paths notify pending. They do not infer retirement from a failed storage read. No uncovered same-class stranding found.
- useInspection polls the current inspector, and readiness/auth/link/session hooks use external-store subscriptions directly.
- useSeen submits through progressive journal admission; its E_ADMISSION_* pre-admission backoff/retry path differs from local asset E_STORE. No raw localUnavailable admission path is used there.
- Imperative client.asset/client.residency/upload/saveAsset/useSaveAsset and explicit action/mutation/uploadAndPlace calls return a typed result/refusal to their caller, with a localStatus rewrite for opening. They have no SDK-owned automatic observation to strand and remain explicitly callable again. Automatically replaying admitted actions or consumed one-view downloads is outside this fix and was not introduced.

No larger independent finding was established by this audit, so no speculative issues ticket was opened. Remaining social-browser failures are isolated separately under the publication red rules.

Additional lifetime check during requalification: `useUpload` assigns `uploads = client as ...`; the effect's existing `uploads` dependency is therefore exactly the client identity. Its added local-status subscription is replaced on a client change, and both subscriptions stop together. No separate missing dependency or additional product finding was established.

Additional opening-fence check: local.ts asset reads refuse opening through `!coreReady`; attachment installs the core and MediaCache before setting coreReady and publishing executable local status. Replica acquisition is a separate state, so an executable notification is a valid asset-read recovery point even before acquired. A subsequent genuine core failure remains a visible refusal rather than being masked as opening.
