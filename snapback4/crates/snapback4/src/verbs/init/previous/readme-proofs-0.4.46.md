
## Frontend proofs

`npm run frontend:proof` builds its own dist, then proves the starter in Chromium.
After replacing the screen, add your business assertions to scripts/frontend-proof.mjs.
New starters include `npm run day2:proof`, saved versions and id-based conservation
across two rollback/forward cycles. Add authenticated business assertions at
BUSINESS_ASSERTION_BEGIN; return deliberately v1-written table/id and changed-field lists there.
Mark deliberate deletes with deleted:true; the proof checks they stay absent.
Existing apps can add it with `snapback4 init --adapt --day2 --apply`.
Set PORT_LO and PORT_HI at run time to confine proof servers and launchers.
Set CHROME=/path/to/chromium or install Playwright's Chromium.
