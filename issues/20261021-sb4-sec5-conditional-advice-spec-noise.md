# SEC5: classify and reduce conditional security-advice specification noise

Status: Open
Scope: Snapback 4 security authoring / LLP 3000.036.004 §14
Date: 2026-10-21
Source: wave-20 SEC5 corpus qualification

The final frozen 300-schema comparison has zero compile/check false refusals,
but that is not evidence of zero advisory noise. Added role/private-column and
caller-clock questions include intentional spec policies. Examples:

- Wave20 006 trainer/physician clinical columns legitimately have broad clinical
  audiences; 050 senior report/value columns likewise have global role audiences.
- Wave20 002 frontdesk/owner contact, 037 registrar identity/value and 042
  coordinator contact columns explicitly grant those global audiences.
- Query-only server-clock uses include caller-selected calendar/availability
  schedules; occurrence in a clock comparison alone does not establish that the
  time must come from the server.

These remain conditional review questions, never refusals or asserted exploits.
Do not advertise the corpus result as zero specification noise or count every
question as a confirmed vulnerability. Counterexample reachability remains
separate from advice.

Evidence: snapback4/reports/20261021-sec5/NOTES.md, the final compressed
notes-query-filter-census.json.gz and notes-query-filter-delta.json. The reviewed
structural criteria are recorded in LLP 3000.036.004 §14.9.

Follow-up: retain source/spec labels for every new site, distinguish intentional
schedules from untrusted event/deadline claims without relying on field names,
and measure precision on a frozen matched corpus before tightening eligibility.
Preserve flags on 001/006/017/025/033/036/048/050, conditional-advice provenance,
and zero false refusals. Any new semantic eligibility contract needs the required
Muse and fresh Codex reviews; do not silently replace a spec decision with a
heuristic or claim the remaining classification work is complete.
