# Lane RL round 2 context

Scope: local watch invalidation/publication (`local.ts`, `local-reads.ts`),
ephemeral recovery (`local-query.ts`), the seeded schedules, client docs.
Used `llp-orient`; no agent delegation.

Governing documents:

- LLP 3000 §4: Snapback 4's fence, independent workspaces and checks. In current/.
- LLP 2000.000 §7.2: the replica's published partition is local read authority.
- LLP 3000.016 §2.2: local complete answers normally win regardless of static
  server classification; pending notification evidence must survive that route.
- LLP 3000.018 §3.2: remembered answers retain existing cut/ticket ordering;
  quiet presence samples remain a separate freshness policy.
- LLP 3000.019 §3.3: observation ownership, expiry and incarnation fences.
  In current/.
- LLP 3000.023 §§3.4, 3.6, 10: unchanged hard boundaries, facade deadlines,
  plain retention and bounded change evidence. In current/.
- LLP 3000.017 §3.3: ephemeral epochs/incarnations and notification authority.
  In current/.
- LLP 3000.029 §0: Shelved; no reinstatement of its ordering system.

The repository foundation is for Snapback 1; the Snapback 4 fence names the
3000-series root instead. Read the client guide card, prior prompts and both
prior reports. The root rules and Snapback 4 NOT-DOING remain binding.

Active constraints: plain same-key revalidation retains; every affected
notification starts the existing non-renewable episode; a pre-change replica
cannot discharge it. Successful applied replacements do not flash loading.
Explicit unavailable answers, denials, keep:false, row expiry and resets keep
their meanings. No public type/flag, new sequence domain, interpreter change,
wasm budget change, publication or push.

Resolution: retain one reported cut per affected watch until published sync
reaches it, accepting a whole server answer at/after it in the meantime.
Existing commit revision and reset fences reject earlier evaluations. Keep the
local eligibility floor after a server replacement until sync, to prevent a
later old replica read from restoring a removed row. Ephemeral offline recovery
carries transport classification unless a held read/prediction blocks it.

Documentation updates: existing LLP 3000.023 §10, client guide, README and
operations manual. Journal append and round2 report. No new LLP; hand-off: none.
