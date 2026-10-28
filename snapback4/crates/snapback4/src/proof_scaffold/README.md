# Schema proof scaffold

Edit cases.mjs. Run `node scripts/proof-scaffold/acceptance.mjs` or
`node scripts/proof-scaffold/frontend-proof.mjs`; the standalone preview is
`node scripts/proof-scaffold/probe-serve.mjs`. Run from the app root with the
installed snapback4 package. To run these proofs in the starter's single loop:

```sh
npm pkg set 'scripts.acceptance=node scripts/proof-scaffold/acceptance.mjs' 'scripts.frontend:proof=node scripts/proof-scaffold/frontend-proof.mjs' 'scripts.probe:serve=exec node scripts/proof-scaffold/probe-serve.mjs'
npm run verify
```

Fill the business assertions first; verify stops at the first red. These files
do not change npm scripts automatically; existing app scripts stay yours.

check writes this packet only after success and updates only untouched files
by SHA-256. Edited files and existing collisions stay yours. To regenerate one
file deliberately, save your work and delete that file, then check again.
New operation/role/guard coverage is checked against schema.json at execution.
The check manifest binds those facts to the current schema; edited/stale facts
refuse explicitly. Save and delete schema.json, then check to refresh them.

Fill each null args/expected/assert. Success cases require a business assertion;
refusal cases already assert exact codes. Set query expectations to
{complete:true}, writes/signals to {state:'sent'}, actions
to {state:'done'}, or refusals to {code:'…'}.
Never copy an observed refusal into the expectation just to turn a test green.
Create the ordinary success path first, then each excluded role and each guard
with earlier guards satisfied. Exercise both users in a role for ownership.
Guard facts and argument types are in schema.json, not package declarations.

The host creates a fresh classified staging deployment, real password accounts,
operator role grants and explicit sign-ins. ctx.sessions[role][0] is the real
account. setup creates business rows via ctx.call, never a fixture/auth bypass.
Custom role provisioning may need accountPlan.args(account). A schema without
password identity refuses instead of silently changing authentication.

ctx.upload(account,'image') uses valid PNG bytes and no file option. File columns
use ctx.upload(account,'file','text/plain'); pass real fixture bytes as the fourth
argument for other allowed MIME types. Do not invent asset IDs. Observe max byte
limits in schema.json. Optional uploads still need explicit success/refusal cases
when the application brief requires them.

Use await ctx.host.now() for timestamps and await ctx.host.advance('31d') for a
single staging jump with ordinary sweeps/jobs and live sessions preserved.
Live clocks tick; test before/after with margin. Exact millisecond boundaries
belong to fixture/local pinned-clock tests. Do not repeat an ambiguous advance.
Fill timeCases for every stored opening/expiry field. Approval assertions reread
the row and use ctx.assertApproval(row,account,reason,{by:'approvedBy',why:'reason'}).
Add revocation, privacy, non-owner, post-approval-edit and omission controls that
the brief requires: a generated matrix is a starting point, not a security proof.

The frontend runner signs in each real account in a fresh browser context.
frontend.assert must drive a visible write, arm beginForm, assert formResult's
SDK receipt, then fresh rendered data; refusal roles assert the code and no edit.
Probe readiness writes a mode-0600 private roster and prints its path and host URL.
Use --hold only for deliberate long-lived previews per the installed probe kit.
