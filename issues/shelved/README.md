# Shelved issues

Tickets that are **not in the current working set**. They are not closed: the
work was not done, withdrawn, or recorded as obsolete. They are parked so
`issues/*.md` stays a working set.

This shelf holds Snapback 1, Snapback 2, and Snapback 3 follow-ups (and
repo-wide tickets filed against those programmes) as of 2026-09-13. The live
working set is Snapback 4.

- Open working set: `issues/YYYYMMDD-slug.md`
- Closed: `issues/closed/YYYYMMDD-slug.md` (must carry **Status:** Closed and
  **Resolution:**)
- Shelved: `issues/shelved/YYYYMMDD-slug.md` (**Status:** stays Open)

To resume a shelved ticket, move it back to `issues/`. To finish one, close it
with `node scripts/issue.mjs close issues/shelved/<file>.md --resolution "…"`.
