# Owned Install 0

Password accounts and online reads. No guest identities, personas or fixture rows.

Run `node scripts/install.mjs`, `npm run verify`, then `npm run backend`
and `npm run dev`. Sign up creates a roleless account. Only the operator may provision roles.
`npm run verify` provisions real staging users, proves a UI write and checks shutdown.
Use acceptance/frontend:proof/probe:check alone for targeted reruns.
For production: deploy production, build against its backend URL, then run `npm run prod:check`.
`prod:serve` deliberately stays up; `snapback4 stop production` stops its backend.
For development accounts use `devAccounts` from `snapback4/proof` with
`{roles:{member:2},provision:api.provision}` on a `startDev` host.
Browser sessions persist in localStorage; reads need the server and offline writes queue.

## Frontend proofs

New starters with a `verify` script use `npm run verify`: Quarry and TypeScript checking, acceptance,
frontend proof, then probe shutdown; the first failure stops the loop.
Allow an initial tool wait of 30000ms and a long proof timeout; progress prints every 5s.
In those starters, `npm run check` generates the API before typechecking. Replace starter fixture
acceptance with application assertions in package.json. Optional proof helpers:
`snapback4 check --proof-draft` creates a compact one-scenario packet once; fill its
cases.mjs and explicitly wire its acceptance runner. `check --proof-scaffold`
creates the exhaustive matrix. Neither is required; reuse host/accounts if useful.

`probe:serve` exits after 10 seconds ready without requests; use --hold or
SNAPBACK4_PROBE_HOLD=1 for deliberate service.

`npm run verify` builds dist and proves the starter in Chromium.
Use acceptance, frontend:proof or probe:check alone only for a targeted rerun; verify names the red phase.
Passing direct acceptance/frontend runs are reused for unchanged source in the same builder session.
Keep the pre/post lifecycle hooks when replacing business commands.
Edit the marked business assertions in scripts/frontend-proof.mjs.
If you opted into the exhaustive packet, edit its frontend.assert callback instead.
New starters include `npm run day2:proof`, saved versions and id-based conservation
across two rollback/forward cycles. Add authenticated business assertions at
BUSINESS_ASSERTION_BEGIN; return deliberately v1-written table/id and changed-field lists there.
Mark deliberate deletes with deleted:true; the proof checks they stay absent.
Existing apps can add it with `snapback4 init --adapt --day2 --apply`.
Set PORT_LO and PORT_HI at run time to confine proof servers and launchers.
Set CHROME=/path/to/chromium or install Playwright's Chromium.
