---
title: Patch one existing row safely
id: operating.data-patch
order: 8
audience: agent-first
capabilities: [operating.data-patch]
authorities: [llp/0184-agent-accessible-control-plane.rfc.md, llp/0024-agent-operating-surface.spec.md, llp/0031-server-route-taxonomy.spec.md, llp/0017-admin-console-inspection-surface.rfc.md, src/data_patch.rs, src/local.rs, src/server.rs, src/cli.rs, packages/snapback-cli/mcp-control.mjs]
examples: [tests/data_patch_v1.rs, packages/snapback-cli/mcp-control.test.mjs]
status: current
targets: [local]
maturity: shipped
since: 0.1.10
reviewed: 2026-08-06
reviewed-authorities-digest: sha256:71ba403fb53322bbe5b84cf21691312bc6c3e51e6d98d324693a02b269434b6c
---

# Patch one existing row safely

> **Local target only.** This page describes the local dev/test target.
> Hosted targets make deliberately weaker or different claims — see
> [auth/targets](../auth/targets.md).

Use `data.patch` to correct known fields on one existing row without adding a
raw SQL, insert, delete, or arbitrary update surface. Preview validates the
closed patch and captures the row's own `_version`; apply consumes a
short-lived single-use capability and commits through the ordinary storage
changeset pipeline. Live queries therefore receive the normal commit
notification.

## Preview

Put the complete authority tuple and operation reason in a JSON file. This
example uses `devUser`, so the server evaluates the request as `user_ada` and
requires the process-bound impersonation capability advertised by the ready
file:

```json fragment reason="example identity, row id, and version are application-specific"
{
  "table": "todos",
  "rowId": "todo_01JEXAMPLE",
  "expectedVersion": 7,
  "patch": { "completed": true },
  "authority": {
    "mode": "devUser",
    "actorPrincipal": null,
    "effectivePrincipal": { "userId": "user_ada", "roles": [] },
    "localDevOnly": true,
    "adminBypass": false,
    "scope": null,
    "reason": null
  },
  "reason": "correct completion state after acceptance review"
}
```

Preview with the JSON body in a file or on stdin. Never put an apply token in
an argument:

```sh
snapback data patch --preview \
  --ready-file .snapback/dev.ready.json \
  --input patch.json > patch-preview.json
```

The response contains the validated before/after field diff, affected live
query classes, catalog digest, startup nonce, a non-authorizing token ID, and
the live apply token. Treat the live token as a short-lived secret. It is bound
to the target, process startup, catalog/schema identity, row and expected
version, normalized patch and diff, full authority tuple, reason, and expiry.

## Apply

Copy the token into the JSON body, not argv. This file-only command prepares
the exact preview input for apply:

```sh
node -e 'const fs=require("fs"); const i=JSON.parse(fs.readFileSync(process.argv[1])); const p=JSON.parse(fs.readFileSync(process.argv[2])); i.applyToken=p.data.applyToken; process.stdout.write(JSON.stringify(i));' \
  patch.json patch-preview.json > patch-apply.json

snapback data patch --apply \
  --ready-file .snapback/dev.ready.json \
  --input patch-apply.json
```

Apply atomically compares and consumes the token before attempting the normal
changeset commit. A second apply cannot reuse it. If the same row changed
after preview, the per-row compare-and-swap fails; a write to an unrelated row
does not. Preview again after any failed commit rather than retrying the old
capability.

The receipt contains only the non-authorizing token ID/digest, catalog digest,
startup nonce, commit version, full authority tuple, and reason. It never
contains the live token.

## Give an agent the same operation through MCP

`snapback mcp-control` exposes two tools:

| Intent | MCP tool | Destructive annotation |
| --- | --- | --- |
| Validate and retain a preview capability | `snapback_data_patch_preview` | `false` |
| Consume that capability and commit | `snapback_data_patch_apply` | `true` (`confirmFirst` in the control catalog) |

The preview tool keeps the live capability inside the bounded MCP process and
returns only `applyTokenId`. Pass that non-authorizing ID plus the exact same
table, row, version, patch, authority, and reason to the apply tool. The raw
token is neither a tool argument nor a tool result. Restarting the MCP process
or letting the preview expire loses the capability; preview again.

## Choose the authority tuple honestly

The operation adds no authority mode. It accepts the existing LLP 0024 local
tuples as-is:

- `devUser` has `effectivePrincipal: { userId, roles }`, `localDevOnly: true`,
  and `adminBypass: false`. Different impersonated users are different token
  bindings.
- `devAdminBypass` has no effective principal, sets `adminBypass: true`, and
  repeats the required operation reason in `authority.reason`. Its receipt
  says `devAdminBypassAdmitted`: app authorization was skipped by an admitted
  local admin bypass, never "evaluated as if authorized."

Both modes still use AdminWrite transport policy. A closed schema rejects
unknown tuple or patch fields, and `_id`, `_version`, `_createdAt`, and
`_updatedAt` remain reserved.

## Know where the operation is refused

Both preview and apply run only on an ordinary primary local non-production
instance. Production profiles, hosted serving, and derived instances return
`SNAPBACK_DATA_PATCH_TARGET_REFUSED`, with `availability: "refused"` in the
diagnostic details. LLP 0158 has not granted derived recognition for this
purpose.

This is a target-availability refusal, not `operability: unavailable`: the
control-catalog rows remain shipped and directly operable on their declared
`local` target. Do not reinterpret a refusal on a different target as evidence
that the operation is missing.

Other stable refusal classes include stale row version, unknown or reserved
field, schema validator/invariant failure, missing/expired/consumed/mismatched
apply token, and invalid authority tuple. Inspect the `SNAPBACK_DATA_PATCH_*`
diagnostic instead of matching message text.

## Anti-patterns

- **Do not add a raw SQL escape hatch.** Use an application mutation when the
  correction needs logic beyond one closed row patch.
- **Do not use a database-wide version as `expectedVersion`.** Read the target
  row's `_version`; unrelated commits must not invalidate the patch.
- **Do not call apply without reviewing the diff.** Apply is deliberately
  destructive and single-use.
- **Do not describe `devAdminBypass` as app-authorized evaluation.** The
  receipt explicitly discloses the admitted authorization skip.
- **Do not expect the operation on forks, hosted instances, or production.**
  Those are deliberate availability refusals in v1.
