# Expo starter publication audit rejects the deepmerge dependency chain

Status: Resolved (incoming main 0.4.45)
Date: 2026-10-28
Scope: Snapback 4 Expo development toolchain / publication consumers

LAT3's packed starter consumer stops at the ordinary Expo audit with
`@expo/cli: a fix is available; update the starter toolchain`. The underlying
finding is deepmerge 4.3.1, GHSA-gcqx-w48m-w2h4. npm reports no fix for deepmerge
itself but `fixAvailable:true` on its transitive `@expo/cli` ancestor.

The retained Integration28 0.4.44 client/native packs reproduce exactly the
same canonical audit rejection. Their foreign dependency version/path graph
is identical to the candidate's; hashes and the actual audit findings are in
[the baseline comparison](../../snapback4/reports/20261027-lat3/starter-audit-baseline.json).
LAT3 changes only proof execution modules and its generated fingerprint; it
does not change starter dependency declarations or the audit policy.

At inspection, `npm view deepmerge version --json` returns `4.3.1` and the
[reviewed advisory](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) lists no
patched release (updated 2026-10-27). Do not turn the npm ancestor flag into an
assumed usable remediation. No dependency downgrade, allowlist entry, audit
threshold or security assertion was changed for LAT3. The starter gate remains
red; later starter cases were not run after the canonical rejection.

Follow up in the frontend toolchain/publication lane: establish a safe patched
dependency path and rerun the complete packed starter matrix, including browser
and listener audits. Packed proof-kit, staging and production consumers passed
independently; see [the consumer receipt](../../snapback4/reports/20261027-lat3/packed-consumers.json).

## Resolution — incoming Integration 29

Merged main contains aeb6fd4c19, a local patched Expo configuration merger.
The strict npm audit and empty allowlist are unchanged. Integration 29 records
complete consumer-only R5 passing on the production native and final packed
0.4.45 bytes; see [its retained verification](../../snapback4/reports/integration29/retained-final-verification.json)
and [consumer result](../../snapback4/reports/integration29/consumer-summary.json).
LAT3 is additionally rechecking its composed proof changes from fresh 0.4.45
packs. The original 0.4.44 red receipt is preserved, not rewritten as passed.
