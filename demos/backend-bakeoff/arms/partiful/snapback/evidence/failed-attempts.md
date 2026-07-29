# Retained failed attempts

All failures below occurred inside the timed window. Every runtime attempt
closed its listeners and removed its exact arm-owned target files.

| Attempt | Classification | Exact observation | Resolution |
| --- | --- | --- | --- |
| Codegen before repository dependencies | environment | `ERR_MODULE_NOT_FOUND: acorn` | Ran the frozen root `bun install --frozen-lockfile`. |
| Codegen without egress admission | docs/discoverability | `BUNDLE_UNSUPPORTED_FETCH` appeared even though `sendNotification` was an Action | Source inspection showed `SNAPBACK_OUTBOUND_ACTIONS=1` must be present during codegen, a requirement not stated on the action guide page. |
| First action/cron handler layout | builder | A no-egress action shared a source file with a fetch action, so its bundle inherited the forbidden ambient fetch | Split notification and cron actions into separate handler sources. |
| First anonymous read | docs/DX | A plain `SnapbackClient` in a sessions app received `SNAPBACK_AUTH_PROFILE_CLIENT_UNSUPPORTED` | Tried the protocol-bearing construction suggested by the diagnostic. |
| Second anonymous read | product/DX | Protocol-bearing construction refused because v1 requires a browser, agent, or external-bearer custody owner | Added a seven-line raw public-query helper with the required auth-client protocol header and no caller-selected auth body. |
| Capability evidence lookup | builder | Harness read `capabilities.capabilities.assetUpload`; the generated manifest carries `assetUpload` at its root | Corrected the evidence lookup; no target state was retained. |
| Cron dedupe replay | builder/DX | An admin `SnapbackClient.mutate` on a sessions app lacked a session protocol/custody context | Used the documented admin-gated function runner for the deterministic replay. |
| Effect refusal assertion | builder/DX | Action handler failures settle inside an HTTP-success `{ok:false, diagnostic}` envelope instead of rejecting like mutation failures | Recorded both action envelope shapes explicitly. |
| Scenario count barrier | builder | The harness required 15 results before the `finally` block appended cleanup | Required 14 before cleanup and 15 after exact cleanup. |
| First UI build | environment | `bunx vite` downloaded a binary but config imports could not resolve Vite/React; arm-local install then rejected root-only `workspace:*` entries | Removed unused backend workspace packages from the UI manifest and created an arm-local Bun lock. |

These attempts are part of the authoring-cost evidence. None was deleted from
the capsule’s command/assistance record merely because the final run passed.
